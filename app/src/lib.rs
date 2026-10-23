//! The Intern-Decision page. The request (its state, questions and images), deciding it and its
//! live measurements are signals here; `web/app.js` decodes the images, runs the engine worker and
//! reports back through `engine` events.

mod answer;
mod app;
mod examples;
