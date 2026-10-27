use percent_encoding::percent_decode_str;
use reqwest::header::{
    HeaderMap, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
    LAST_MODIFIED, RANGE,
};
use serde::Serialize;

use super::{error_text, RequestInfo};
use crate::models::Kind;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub final_url: String,
    pub size: Option<u64>,
    pub resumable: bool,
    pub file_name: String,
    pub content_type: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub kind: Kind,
}

/// Asks the server for the first byte. A 206 answer means ranges (and so multiple connections
/// and resume) are supported, and Content-Range tells us the total size.
pub async fn probe(client: &reqwest::Client, req: &RequestInfo) -> Result<ProbeResult, String> {
    let resp = req
        .get(client, &req.url)
        .header(RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|e| error_text(&e))?;

    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let headers = resp.headers().clone();
    drop(resp);

    let header = |h| {
        headers
            .get(h)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let content_type = header(CONTENT_TYPE);

    let (size, resumable) = match status {
        206 => {
            let total = header(CONTENT_RANGE)
                .and_then(|cr| cr.rsplit('/').next().map(str::to_string))
                .and_then(|t| t.trim().parse::<u64>().ok());
            (total, total.is_some())
        }
        200 => {
            let len = header(CONTENT_LENGTH).and_then(|l| l.parse::<u64>().ok());
            (len, false)
        }
        416 => (Some(0), false),
        s => return Err(format!("Server replied HTTP {s}")),
    };

    let is_hls = content_type
        .as_deref()
        .map(|c| c.to_ascii_lowercase().contains("mpegurl"))
        .unwrap_or(false)
        || url_path(&final_url).to_ascii_lowercase().ends_with(".m3u8");

    let mut file_name = file_name_from(&headers, &final_url, content_type.as_deref());
    if is_hls {
        let stem = file_name
            .rsplit_once('.')
            .map(|(s, _)| s.to_string())
            .unwrap_or(file_name.clone());
        file_name = format!("{stem}.ts");
    }

    Ok(ProbeResult {
        final_url,
        size: if is_hls { None } else { size },
        resumable: resumable && !is_hls,
        file_name,
        content_type,
        etag: header(ETAG),
        last_modified: header(LAST_MODIFIED),
        kind: if is_hls { Kind::Hls } else { Kind::Http },
    })
}

fn url_path(url: &str) -> String {
    reqwest::Url::parse(url)
        .map(|u| u.path().to_string())
        .unwrap_or_default()
}

pub fn file_name_from(headers: &HeaderMap, url: &str, content_type: Option<&str>) -> String {
    let from_header = headers
        .get(CONTENT_DISPOSITION)
        .and_then(|v| {
            v.to_str()
                .ok()
                .map(str::to_string)
                .or_else(|| Some(String::from_utf8_lossy(v.as_bytes()).into_owned()))
        })
        .and_then(|v| parse_content_disposition(&v));

    let name = from_header.unwrap_or_else(|| {
        let path = url_path(url);
        let last = path.rsplit('/').next().unwrap_or("");
        percent_decode_str(last).decode_utf8_lossy().into_owned()
    });

    let mut name = sanitize_file_name(&name);
    if !name.contains('.') {
        if let Some(ext) = content_type.and_then(ext_for_mime) {
            name = format!("{name}.{ext}");
        }
    }
    name
}

pub fn parse_content_disposition(v: &str) -> Option<String> {
    let mut plain = None;
    for part in v.split(';').map(str::trim) {
        let lower = part.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("filename*=").map(|_| &part[10..]) {
            // RFC 5987: charset'lang'percent-encoded
            let encoded = rest
                .splitn(3, '\'')
                .nth(2)
                .unwrap_or(rest)
                .trim_matches('"');
            let decoded = percent_decode_str(encoded).decode_utf8_lossy().into_owned();
            if !decoded.is_empty() {
                return Some(decoded);
            }
        } else if lower.starts_with("filename=") {
            let raw = part[9..].trim().trim_matches('"');
            plain = Some(percent_decode_str(raw).decode_utf8_lossy().into_owned());
        }
    }
    plain.filter(|s| !s.is_empty())
}

pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    let cleaned: String = cleaned.chars().take(200).collect();
    if cleaned.is_empty() {
        "download".into()
    } else {
        cleaned
    }
}

fn ext_for_mime(ct: &str) -> Option<&'static str> {
    let ct = ct.split(';').next()?.trim().to_ascii_lowercase();
    Some(match ct.as_str() {
        "application/zip" | "application/x-zip-compressed" => "zip",
        "application/x-rar-compressed" | "application/vnd.rar" => "rar",
        "application/x-7z-compressed" => "7z",
        "application/pdf" => "pdf",
        "application/x-msdownload" | "application/x-msdos-program" => "exe",
        "application/x-msi" => "msi",
        "application/gzip" | "application/x-gzip" => "gz",
        "audio/mpeg" => "mp3",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/x-matroska" => "mkv",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "text/plain" => "txt",
        "text/html" => "html",
        "application/json" => "json",
        "application/vnd.apple.mpegurl" | "application/x-mpegurl" => "m3u8",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_disposition() {
        assert_eq!(
            parse_content_disposition(r#"attachment; filename="a b.zip""#).unwrap(),
            "a b.zip"
        );
        assert_eq!(
            parse_content_disposition("attachment; filename*=UTF-8''na%C3%AFve.pdf").unwrap(),
            "naïve.pdf"
        );
        assert_eq!(parse_content_disposition("inline"), None);
    }

    #[test]
    fn sanitize() {
        assert_eq!(sanitize_file_name("a:b?.txt"), "a_b_.txt");
        assert_eq!(sanitize_file_name("  ..."), "download");
    }
}
