//! A response as the page draws it: each question's options with their calibrated
//! probabilities, the decision first among equals as the model ranked it, and what the answer
//! reads (its confidence, a yes's probability, or a score's expected value).

use serde::Deserialize;
use serde_json::{Map, Value};

/// One option of an answer: its value (with a score's legend), its probability and whether it
/// is the decision.
#[derive(Clone, PartialEq)]
pub(crate) struct Choice {
    pub(crate) index: usize,
    pub(crate) label: String,
    pub(crate) probability: f64,
    pub(crate) chosen: bool,
}

impl Choice {
    pub(crate) fn percent(&self) -> String {
        format!("{:.1}%", self.probability * 100.0)
    }

    /// The width of its bar.
    pub(crate) fn bar(&self) -> String {
        format!("width: {:.2}%", self.probability * 100.0)
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct Answer {
    pub(crate) name: String,
    pub(crate) kind: &'static str,
    pub(crate) decision: String,
    pub(crate) reading: String,
    pub(crate) choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Response {
    answers: Map<String, Value>,
}

/// An answer as the runtime writes it (`intern_decision::decision`).
#[derive(Deserialize)]
struct Written {
    #[serde(rename = "type")]
    kind: String,
    probabilities: Map<String, Value>,
    confidence: f64,
    decision: String,
    #[serde(default)]
    score: Option<f64>,
    #[serde(default)]
    legend: Map<String, Value>,
}

/// The answers of a response's JSON, in order; none while there is no response.
pub(crate) fn answers(response: &str) -> Vec<Answer> {
    let Ok(response) = serde_json::from_str::<Response>(response) else {
        return Vec::new();
    };
    let written = response.answers.into_iter().filter_map(|(name, answer)| {
        // An answer the page cannot read is left out rather than drawn wrong.
        serde_json::from_value::<Written>(answer).ok()?.drawn(name)
    });
    written.collect()
}

impl Written {
    /// The answer drawn; `None` when a probability is not a number.
    fn drawn(self, name: String) -> Option<Answer> {
        let choices = self
            .probabilities
            .iter()
            .enumerate()
            .map(|(index, (value, probability))| {
                let label = match self.legend.get(value).and_then(Value::as_str) {
                    Some(description) => format!("{value} · {description}"),
                    None => value.clone(),
                };
                Some(Choice {
                    index,
                    label,
                    probability: probability.as_f64()?,
                    chosen: *value == self.decision,
                })
            });
        let choices = choices.collect::<Option<Vec<_>>>()?;
        let (kind, reading) = match (self.kind.as_str(), self.score) {
            ("score", Some(score)) => ("Score", format!("expected score {score:.2}")),
            ("noul", _) => ("Yes or no", format!("{:.0}% sure", self.confidence * 100.0)),
            _ => ("Choice", format!("{:.0}% sure", self.confidence * 100.0)),
        };
        Some(Answer {
            name,
            kind,
            decision: self.decision,
            reading,
            choices,
        })
    }
}
