class RunExecutionLock {
  constructor() {
    this.active = false;
  }

  tryAcquire() {
    if (this.active) return null;
    this.active = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = false;
    };
  }

  isActive() {
    return this.active;
  }
}

const DEFAULT_RUN_EXECUTION_LOCK = new RunExecutionLock();

module.exports = {
  DEFAULT_RUN_EXECUTION_LOCK,
  RunExecutionLock,
};
