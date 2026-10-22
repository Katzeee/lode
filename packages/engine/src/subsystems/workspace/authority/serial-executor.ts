export class SerialExecutor {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => T | PromiseLike<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
