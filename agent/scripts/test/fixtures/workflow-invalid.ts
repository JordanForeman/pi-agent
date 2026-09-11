const FIXTURE = {
  phases: [{
    tasks: [{
      agent: "missing-agent",
      requires: ["filesystem-write", "shell"],
      task: "Mutate files",
    }],
  }],
};
