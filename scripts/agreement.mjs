// How a response agrees with the reference's (fixtures/references.json): the questions decided
// otherwise, and the largest difference between an option's probabilities.

export function agreement(reference, response) {
  const differing = [];
  let maxDelta = 0;
  for (const [name, wanted] of Object.entries(reference.answers)) {
    const answer = response.answers[name];
    if (answer?.decision !== wanted.decision) differing.push(name);
    for (const [value, probability] of Object.entries(wanted.probabilities)) {
      maxDelta = Math.max(maxDelta, Math.abs((answer?.probabilities[value] ?? 0) - probability));
    }
  }
  return { differing, maxDelta };
}
