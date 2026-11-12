export const READY = "ready-for-agent";
export const TAKEN = "agent-in-progress"; // someone (a person or a loop) is on it: skip
export const REVIEW = "agent-review";
export const STOPPED = "agent-stopped";

export type Issue = {
  number: number;
  body: string;
  labels: { name: string }[];
  blockedBy: { nodes: { number: number; state: string }[] };
};

// Tickets (not PRDs) in an order where every blocker is closed, already done by this
// loop process (`done`), or runs earlier in this plan. Tickets labelled TAKEN are left out,
// so their dependents wait.
export function plan(ready: Issue[], done: number[] = []): { order: number[]; waiting: string[]; taken: number[] } {
  const tickets = ready.filter((i) => /## Parent/.test(i.body)).sort((a, b) => a.number - b.number);
  const isTaken = (i: Issue) => i.labels.some((l) => l.name === TAKEN);
  const todo = tickets.filter((i) => !isTaken(i));
  const order: number[] = [];
  const pending = (i: Issue) =>
    i.blockedBy.nodes
      .filter((b) => b.state !== "CLOSED" && !done.includes(b.number) && !order.includes(b.number))
      .map((b) => `#${b.number}`);

  let next: Issue | undefined;
  while ((next = todo.find((i) => !order.includes(i.number) && !pending(i).length))) order.push(next.number);

  const waiting = todo.filter((i) => !order.includes(i.number)).map((i) => `#${i.number} waits on ${pending(i).join(", ")}`);
  return { order, waiting, taken: tickets.filter(isTaken).map((i) => i.number) };
}

// Known positive for the planner. gh lists newest first; #2 is the PRD, #4 is open but not
// ready, #11 was taken interactively. A check that can't fire looks like a pass.
export function checkPlanner() {
  const t = (number: number, labels: string[], ...blockers: [number, string][]): Issue => ({
    number,
    body: "## Parent\n\n#2",
    labels: labels.map((name) => ({ name })),
    blockedBy: { nodes: blockers.map(([number, state]) => ({ number, state })) },
  });
  const issues = [
    t(12, [], [11, "OPEN"]), t(11, [TAKEN]), t(10, [], [1, "CLOSED"]), t(9, []), t(8, [], [9, "OPEN"]),
    t(7, [], [5, "OPEN"]), t(6, [], [5, "OPEN"]), t(5, [], [3, "OPEN"], [4, "OPEN"]), t(3, []),
    { ...t(2, []), body: "# PRD" },
  ];
  const first = plan(issues);
  // After #3 and #9 are done, gh no longer lists them as ready, but they're still OPEN.
  const later = plan(issues.filter((i) => ![3, 9].includes(i.number)), [3, 9]);
  const got = `${first.order.join(" ")} | ${first.waiting.length} | ${first.taken.join(" ")} | ${later.order.join(" ")}`;
  const want = "3 9 8 10 | 4 | 11 | 8 10";
  if (got !== want) throw new Error(`planner is broken: got "${got}", want "${want}"`);
}
