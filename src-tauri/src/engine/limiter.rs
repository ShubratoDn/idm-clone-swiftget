use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Global speed limiter shared by every connection of every download.
/// Works as a token bucket that may go into debt: a caller that overdraws sleeps until it is repaid.
pub struct RateLimiter {
    state: Mutex<State>,
}

struct State {
    rate: f64,
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    pub fn new(bytes_per_sec: u64) -> Self {
        RateLimiter {
            state: Mutex::new(State {
                rate: bytes_per_sec as f64,
                tokens: 0.0,
                last: Instant::now(),
            }),
        }
    }

    /// 0 means unlimited.
    pub fn set_rate(&self, bytes_per_sec: u64) {
        let mut s = self.state.lock().unwrap();
        s.rate = bytes_per_sec as f64;
        s.tokens = 0.0;
        s.last = Instant::now();
    }

    pub async fn acquire(&self, n: usize) {
        let wait = {
            let mut s = self.state.lock().unwrap();
            if s.rate <= 0.0 {
                return;
            }
            let now = Instant::now();
            let elapsed = now.duration_since(s.last).as_secs_f64();
            s.last = now;
            // Allow at most a quarter second of burst.
            s.tokens = (s.tokens + elapsed * s.rate).min(s.rate / 4.0);
            s.tokens -= n as f64;
            if s.tokens >= 0.0 {
                None
            } else {
                Some(Duration::from_secs_f64(-s.tokens / s.rate))
            }
        };
        if let Some(w) = wait {
            tokio::time::sleep(w).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn limits_throughput() {
        let lim = RateLimiter::new(200_000);
        let start = Instant::now();
        for _ in 0..20 {
            lim.acquire(20_000).await; // 400 KB total at 200 KB/s ≈ 2 s
        }
        let secs = start.elapsed().as_secs_f64();
        assert!(secs > 1.6 && secs < 2.6, "took {secs}s");
    }
}
