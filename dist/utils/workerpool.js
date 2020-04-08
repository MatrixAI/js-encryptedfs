// interface Task<data, result> {
//     runAsync(data: data): Promise<result>
// }
// interface WorkerPool {
//     createTask<data, result>(f: (d:data) => result): Task<data, result>
// }
// interface WorkerPoolOptions {
//     workers: number
// }
// const createWorkerpool = (options: WorkerPoolOptions): WorkerPool => {
//     const workers = new Map(Array.from({ length: options.workers }).map<[number, Worker]>(() => {
//         const w = new Worker('./worker.ts')
//         return [w.threadId, w]
//     }))
//     const idle = Array.from(workers.keys())
//     const resolvers = new Map<number, (data: any) => void>()
//     let backlog: { id: number, task: (data:any) => void, data: any }[] = []
//     let taskIdCounter = 0
//     const runNext = () => {
//         if (backlog.length == 0 || idle.length == 0) return
//         const task = backlog.shift()
//         const worker = idle.shift()
//         console.log(`scheduling ${task.id} on ${worker}`)
//         const msg = {...task, task: task.task.toString()}
//         workers.get(worker).postMessage(msg)
//         runNext()
//     }
//     workers.forEach((w, i) => {
//         w.on('message', data => {
//         const { id, result }= data
//         resolvers.get(Number(id))(result)
//         resolvers.delete(id)
//         idle.push(i)
//         runNext()
//         })
//     })
//     return { /* ... */ }
// }
//# sourceMappingURL=workerpool.js.map