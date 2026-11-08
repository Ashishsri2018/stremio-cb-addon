class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
    this.label = label;
    this.timeoutMs = ms;
    this.code = 'ETIMEDOUT';
  }
}

function withTimeout(promise, ms, label = 'operation') {
  const source = Promise.resolve(promise);
  source.catch(() => {});

  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });

  return Promise.race([source, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { TimeoutError, withTimeout };
