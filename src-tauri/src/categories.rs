/// IDM-style categories, picked from the file extension.
pub const CATEGORIES: &[(&str, &[&str])] = &[
    (
        "Compressed",
        &[
            "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "iso", "cab", "arj", "lzh", "ace",
            "z", "zst", "img",
        ],
    ),
    (
        "Documents",
        &[
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pps", "txt", "rtf", "odt", "ods",
            "epub", "csv", "md",
        ],
    ),
    (
        "Music",
        &[
            "mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus", "aif", "mpa", "ra",
        ],
    ),
    (
        "Programs",
        &[
            "exe", "msi", "msu", "apk", "dmg", "deb", "rpm", "appimage", "msix", "bin", "jar",
        ],
    ),
    (
        "Video",
        &[
            "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "mpe", "ts",
            "3gp", "asf", "ogv", "rm", "rmvb", "qt",
        ],
    ),
];

pub fn category_for(file_name: &str) -> &'static str {
    let ext = file_name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if !file_name.contains('.') {
        return "General";
    }
    for (name, exts) in CATEGORIES {
        if exts.contains(&ext.as_str()) {
            return name;
        }
    }
    "General"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories() {
        assert_eq!(category_for("setup.EXE"), "Programs");
        assert_eq!(category_for("movie.mkv"), "Video");
        assert_eq!(category_for("README"), "General");
    }
}
