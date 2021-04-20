interface WorkerManagerInterface<T> {
  call<R>(f: (worker: T) => Promise<R>): Promise<R>;
}

export { WorkerManagerInterface };
