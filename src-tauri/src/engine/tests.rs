//! End-to-end engine tests against a local server that throttles every connection,
//! the way many real file hosts do.

use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use super::http::HttpTask;
use super::limiter::RateLimiter;
use super::{build_client, Outcome, RequestInfo, TaskShared};

const PER_CONNECTION_BPS: usize = 2 * 1024 * 1024;

struct Throttled {
    data: Arc<Vec<u8>>,
    pos: usize,
    end: usize,
}

impl Read for Throttled {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = buf.len().min(32 * 1024).min(self.end - self.pos);
        if n == 0 {
            return Ok(0);
        }
        std::thread::sleep(Duration::from_secs_f64(
            n as f64 / PER_CONNECTION_BPS as f64,
        ));
        buf[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}

/// Serves `data` with Range support on a random local port; returns the URL.
/// With `max_connections`, extra simultaneous requests get HTTP 503 like a connection-capped host.
fn serve_limited(data: Arc<Vec<u8>>, max_connections: usize) -> String {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let open = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let data = data.clone();
            let open = open.clone();
            std::thread::spawn(move || {
                if open.fetch_add(1, std::sync::atomic::Ordering::SeqCst) >= max_connections {
                    open.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                    let _ = req.respond(tiny_http::Response::empty(503));
                    return;
                }
                let total = data.len();
                let range = req
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("Range"))
                    .and_then(|h| h.value.as_str().strip_prefix("bytes=").map(str::to_string));
                let (start, end, status) = match range {
                    Some(r) => {
                        let (a, b) = r.split_once('-').unwrap();
                        let a: usize = a.parse().unwrap();
                        let b: usize = if b.is_empty() {
                            total - 1
                        } else {
                            b.parse::<usize>().unwrap().min(total - 1)
                        };
                        (a, b + 1, 206)
                    }
                    None => (0, total, 200),
                };
                let mut headers =
                    vec![tiny_http::Header::from_bytes("Accept-Ranges", "bytes").unwrap()];
                if status == 206 {
                    headers.push(
                        tiny_http::Header::from_bytes(
                            "Content-Range",
                            format!("bytes {}-{}/{}", start, end - 1, total),
                        )
                        .unwrap(),
                    );
                }
                headers.push(
                    tiny_http::Header::from_bytes(
                        "Content-Disposition",
                        "attachment; filename=\"test.bin\"",
                    )
                    .unwrap(),
                );
                let body = Throttled {
                    data,
                    pos: start,
                    end,
                };
                let resp = tiny_http::Response::new(
                    tiny_http::StatusCode(status),
                    headers,
                    body,
                    Some(end - start),
                    None,
                );
                let _ = req.respond(resp);
                open.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            });
        }
    });
    format!("http://127.0.0.1:{port}/file.bin")
}

fn serve(data: Arc<Vec<u8>>) -> String {
    serve_limited(data, usize::MAX)
}

fn test_data(len: usize) -> Arc<Vec<u8>> {
    let mut x: u32 = 12345;
    Arc::new(
        (0..len)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x as u8
            })
            .collect(),
    )
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("swiftget-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn task(
    url: &str,
    dir: &PathBuf,
    connections: u32,
    shared: Arc<TaskShared>,
    cancel: CancellationToken,
) -> HttpTask {
    HttpTask {
        client: build_client(),
        req: RequestInfo {
            url: url.into(),
            user_agent: "test".into(),
            ..Default::default()
        },
        part_path: dir.join("test.bin.swg"),
        final_path: dir.join("test.bin"),
        connections,
        max_retries: 3,
        shared,
        cancel,
        limiter: Arc::new(RateLimiter::new(0)),
    }
}

async fn timed_download(url: &str, connections: u32, data: &[u8]) -> f64 {
    let dir = temp_dir(&format!("c{connections}"));
    let start = Instant::now();
    let out = task(
        url,
        &dir,
        connections,
        Arc::new(TaskShared::default()),
        CancellationToken::new(),
    )
    .run()
    .await
    .unwrap();
    let secs = start.elapsed().as_secs_f64();
    let Outcome::Completed(name) = out else {
        panic!("not completed")
    };
    assert_eq!(name, "test.bin");
    assert!(
        std::fs::read(dir.join(&name)).unwrap() == data,
        "file content mismatch"
    );
    let _ = std::fs::remove_dir_all(&dir);
    secs
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn multi_connection_is_faster_and_correct() {
    let data = test_data(8 * 1024 * 1024);
    let url = serve(data.clone());

    let single = timed_download(&url, 1, &data).await;
    let multi = timed_download(&url, 8, &data).await;
    println!(
        "1 connection: {single:.2}s, 8 connections: {multi:.2}s, speed-up {:.1}x",
        single / multi
    );
    // Typically ~8x; the margin keeps slow, shared CI machines from failing the test.
    assert!(
        multi * 2.0 < single,
        "expected a big speed-up, got {single:.2}s vs {multi:.2}s"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn survives_server_connection_cap() {
    let data = test_data(4 * 1024 * 1024);
    let url = serve_limited(data.clone(), 2);
    let dir = temp_dir("capped");
    let out = task(
        &url,
        &dir,
        8,
        Arc::new(TaskShared::default()),
        CancellationToken::new(),
    )
    .run()
    .await
    .unwrap();
    let Outcome::Completed(name) = out else {
        panic!("not completed")
    };
    assert!(
        std::fs::read(dir.join(name)).unwrap() == *data,
        "file content mismatch"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// Real-network benchmark: `SWG_BENCH_URL=<url> cargo test bench_real -- --ignored --nocapture`
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn bench_real_server() {
    let url = std::env::var("SWG_BENCH_URL").expect("set SWG_BENCH_URL");
    let list = std::env::var("SWG_BENCH_CONNS").unwrap_or_else(|_| "1 8".into());
    for connections in list.split_whitespace().map(|c| c.parse::<u32>().unwrap()) {
        let dir = temp_dir(&format!("bench{connections}"));
        let shared = Arc::new(TaskShared::default());
        let start = Instant::now();
        let mut t = task(
            &url,
            &dir,
            connections,
            shared.clone(),
            CancellationToken::new(),
        );
        t.max_retries = 20; // the app's default
        let out = t.run().await.unwrap();
        let secs = start.elapsed().as_secs_f64();
        assert!(matches!(out, Outcome::Completed(_)));
        let bytes = shared.downloaded(false) as f64;
        println!(
            "{connections} connection(s): {:.1} MB in {secs:.2}s = {:.2} MB/s",
            bytes / 1048576.0,
            bytes / 1048576.0 / secs
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pause_and_resume_keeps_file_intact() {
    let data = test_data(8 * 1024 * 1024);
    let url = serve(data.clone());
    let dir = temp_dir("resume");
    let shared = Arc::new(TaskShared::default());

    // Pause once real progress exists, however slow the machine running the test is.
    let cancel = CancellationToken::new();
    let stopper = cancel.clone();
    let watched = shared.clone();
    tokio::spawn(async move {
        let deadline = Instant::now() + Duration::from_secs(60);
        while watched.downloaded(false) < 1024 * 1024 && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        stopper.cancel();
    });
    let out = task(&url, &dir, 4, shared.clone(), cancel)
        .run()
        .await
        .unwrap();
    assert!(matches!(out, Outcome::Cancelled));
    let partial = shared.downloaded(false);
    assert!(
        partial > 0 && partial < data.len() as u64,
        "partial = {partial}"
    );

    // Resume with the saved segment state, the way the manager does after a restart.
    let saved = shared.state.lock().unwrap().clone();
    let resumed = Arc::new(TaskShared::default());
    *resumed.state.lock().unwrap() = saved;
    let out = task(&url, &dir, 4, resumed.clone(), CancellationToken::new())
        .run()
        .await
        .unwrap();
    let Outcome::Completed(name) = out else {
        panic!("not completed")
    };
    assert!(
        std::fs::read(dir.join(name)).unwrap() == *data,
        "resumed file differs"
    );
    // Only the missing part was fetched the second time.
    let refetched = resumed.bytes.load(std::sync::atomic::Ordering::Relaxed);
    assert!(
        refetched < data.len() as u64 - partial / 2,
        "refetched {refetched} bytes"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
