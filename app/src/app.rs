use fusor::{JsInputs, Signal, signal};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::answer::{Answer, answers};
use crate::examples::{EXAMPLES, Example};

/// An image added to the request, once decoded.
#[derive(Clone, PartialEq, Deserialize)]
struct Picture {
    index: usize,
    name: String,
    width: u32,
    height: u32,
}

impl Picture {
    fn summary(&self) -> String {
        format!("{} · {}×{}", self.name, self.width, self.height)
    }
}

// The runtime build and the bundle, once loaded.
#[derive(Clone, PartialEq, Deserialize)]
struct Loaded {
    build: String,
    threads: u32,
    bundle_bytes: f64,
    load_ms: f64,
    // Every part came from this device's storage.
    from_device: bool,
}

impl Loaded {
    fn summary(&self) -> String {
        let threads = match self.threads {
            1 => "1 thread".to_string(),
            count => format!("{count} threads"),
        };
        let source = if self.from_device {
            "model loaded from this device"
        } else {
            "model downloaded"
        };
        format!(
            "{} · {threads} · {:.0} MB bundle · {source} in {:.1} s",
            self.build,
            self.bundle_bytes / 1e6,
            self.load_ms / 1000.0
        )
    }
}

/// What `web/app.js` measures while a request is decided: the time from Decide to the answers
/// (`total_ms`), the prompt's tokens and its images', the time the prompt took through the
/// language model (`reading_ms`), and the network requests made since the model loaded.
#[derive(Clone, Default, PartialEq, Deserialize)]
struct Metrics {
    total_ms: Option<f64>,
    prompt_tokens: u32,
    image_tokens: u32,
    reading_ms: f64,
    requests: u32,
}

impl Metrics {
    fn time(&self) -> String {
        self.total_ms
            .map_or("–".into(), |ms| format!("{:.2} s", ms / 1000.0))
    }

    fn speed(&self) -> String {
        if self.total_ms.is_none() || self.reading_ms == 0.0 {
            return "–".into();
        }
        let tokens = f64::from(self.prompt_tokens);
        format!("{:.0}/s", tokens * 1000.0 / self.reading_ms)
    }

    fn tokens(&self) -> String {
        self.prompt_tokens.to_string()
    }

    fn image_tokens(&self) -> String {
        self.image_tokens.to_string()
    }

    fn requests(&self) -> String {
        self.requests.to_string()
    }
}

// What `web/app.js` reports, one JSON object per `engine` event.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Report {
    Loading {
        fraction: f64,
        detail: String,
    },
    Ready {
        loaded: Loaded,
    },
    // The request's images, after one was added or they were cleared.
    Pictures {
        pictures: Vec<Picture>,
    },
    // What the engine is doing, and the share of the prompt read.
    Progress {
        status: String,
        fraction: f64,
        metrics: Metrics,
    },
    // The response as the runtime wrote it, empty when stopped.
    Done {
        response: String,
        status: String,
        metrics: Metrics,
    },
    // Something failed; the engine can take the next request.
    Error {
        message: String,
    },
    // The model could not load, or the engine died: nothing more can run in this page.
    Broken {
        message: String,
    },
}

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Idle,
    Deciding,
    Broken,
}

impl Phase {
    fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Deciding => "deciding",
            Self::Broken => "broken",
        }
    }
}

#[derive(JsInputs)]
struct App {
    state_text: Signal<String>,
    questions_text: Signal<String>,
    // `web/app.js` acts on every new count: `decides` (Decide) sends `request` and the images to
    // the engine, `stops` stops the decision, `clears` forgets the images, `copies` copies the
    // response.
    #[js]
    request: Signal<String>,
    #[js]
    decides: Signal<u32>,
    #[js]
    stops: Signal<u32>,
    #[js]
    clears: Signal<u32>,
    #[js]
    copies: Signal<u32>,
    phase: Signal<Phase>,
    fraction: Signal<f64>,
    detail: Signal<String>,
    status: Signal<String>,
    progress: Signal<f64>,
    pictures: Signal<Vec<Picture>>,
    response: Signal<String>,
    metrics: Signal<Metrics>,
    measured: Signal<bool>,
    loaded: Signal<Option<Loaded>>,
}

impl App {
    fn new() -> Self {
        let example = &EXAMPLES[0];
        Self {
            state_text: signal(example.state.trim_end().into()),
            questions_text: signal(example.questions.trim_end().into()),
            request: signal(String::new()),
            decides: signal(0),
            stops: signal(0),
            clears: signal(0),
            copies: signal(0),
            phase: signal(Phase::Idle),
            fraction: signal(0.0),
            detail: signal("Starting…".into()),
            status: signal(example.hint.into()),
            progress: signal(0.0),
            pictures: signal(Vec::new()),
            response: signal(String::new()),
            metrics: signal(Metrics::default()),
            measured: signal(false),
            loaded: signal(None),
        }
    }

    fn examples(&self) -> Vec<Example> {
        EXAMPLES.to_vec()
    }

    fn pick(&self, example: &Example) {
        self.state_text.set(example.state.trim_end().into());
        self.questions_text.set(example.questions.trim_end().into());
        self.status.set(example.hint.into());
    }

    fn decide(&self) {
        let request = match self.compose() {
            Ok(request) => request,
            Err(message) => return self.status.set(message),
        };
        self.request.set(request);
        self.response.set(String::new());
        self.metrics.set(Metrics::default());
        self.progress.set(0.0);
        self.measured.set(true);
        self.phase.set(Phase::Deciding);
        let status = if self.loaded.get().is_some() {
            "Reading the request…"
        } else {
            "Deciding once the model is ready."
        };
        self.status.set(status.into());
        self.decides.update(|count| *count += 1);
    }

    /// The request as the runtime takes it: the state as JSON when it parses as JSON, else as
    /// its text, and the questions' object in its order.
    fn compose(&self) -> Result<String, String> {
        let state_text = self.state_text.get();
        // A state that is not JSON is a description in words, as the reference takes it.
        let state = serde_json::from_str(&state_text).unwrap_or(Value::String(state_text));
        let questions: Map<String, Value> = serde_json::from_str(&self.questions_text.get())
            .map_err(|error| format!("The questions are not a JSON object: {error}."))?;
        let request = serde_json::json!({ "state": state, "questions": questions });
        Ok(request.to_string())
    }

    fn stop(&self) {
        self.stops.update(|count| *count += 1);
    }

    fn clear(&self) {
        self.clears.update(|count| *count += 1);
    }

    fn copy(&self) {
        self.copies.update(|count| *count += 1);
    }

    fn receive(&self, event: web_sys::Event) {
        let json = fusor::js::event_detail::<String>(&event).expect("web/app.js sends strings");
        let report = serde_json::from_str(&json).expect("web/app.js sends engine reports");
        match report {
            Report::Loading { fraction, detail } => {
                self.fraction.set(fraction);
                self.detail.set(detail);
            }
            Report::Ready { loaded } => self.loaded.set(Some(loaded)),
            Report::Pictures { pictures } => self.pictures.set(pictures),
            Report::Progress {
                status,
                fraction,
                metrics,
            } => {
                self.status.set(status);
                self.progress.set(fraction);
                self.metrics.set(metrics);
            }
            Report::Done {
                response,
                status,
                metrics,
            } => {
                self.response.set(response);
                self.status.set(status);
                self.metrics.set(metrics);
                self.phase.set(Phase::Idle);
            }
            Report::Error { message } => {
                self.status.set(format!("error: {message}"));
                self.phase.set(Phase::Idle);
            }
            Report::Broken { message } => {
                self.detail.set(message);
                self.phase.set(Phase::Broken);
            }
        }
    }

    fn summary(&self) -> String {
        self.loaded
            .get()
            .map_or(String::new(), |loaded| loaded.summary())
    }

    fn pictures_summary(&self) -> String {
        match self.pictures.get().len() {
            0 => "No images: the state and the questions alone.".into(),
            1 => "1 image".into(),
            count => format!("{count} images"),
        }
    }

    fn loading(&self) -> bool {
        self.loaded.get().is_none() && self.phase.get() != Phase::Broken
    }

    // The model never loaded: likely a bundle that does not match the runtime.
    fn failed_to_load(&self) -> bool {
        self.loaded.get().is_none()
    }

    fn idle(&self) -> bool {
        self.phase.get() == Phase::Idle
    }

    fn decide_label(&self) -> &'static str {
        match self.phase.get() {
            Phase::Deciding => "Deciding…",
            _ if self.loaded.get().is_none() => "Decide now, starts when ready",
            _ => "Decide",
        }
    }

    fn empty(&self) -> bool {
        self.response.get().is_empty()
    }

    // Each question's answer as the page draws it: its options' probabilities as bars.
    fn answers(&self) -> Vec<Answer> {
        answers(&self.response.get())
    }
}

fusor::template!("web/index.html");
