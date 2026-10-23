//! The requests the page offers to start from: a state and questions as the editors hold them.

/// An example request: its state (JSON or words) and its questions (a JSON object), with a hint
/// of what to try.
#[derive(Clone, PartialEq)]
pub(crate) struct Example {
    pub(crate) id: &'static str,
    pub(crate) label: &'static str,
    pub(crate) hint: &'static str,
    pub(crate) state: &'static str,
    pub(crate) questions: &'static str,
}

pub(crate) const EXAMPLES: [Example; 3] = [
    Example {
        id: "support",
        label: "Support ticket",
        hint: "Route a customer's message: edit the state or the questions, then press Decide.",
        state: include_str!("../examples/support/state.json"),
        questions: include_str!("../examples/support/questions.json"),
    },
    Example {
        id: "review",
        label: "Comment review",
        hint: "Review a comment before it is published.",
        state: include_str!("../examples/review/state.txt"),
        questions: include_str!("../examples/review/questions.json"),
    },
    Example {
        id: "seal",
        label: "Document with a seal",
        hint: "Add an image of a document (drop, paste or choose one), then press Decide.",
        state: include_str!("../examples/seal/state.txt"),
        questions: include_str!("../examples/seal/questions.json"),
    },
];
