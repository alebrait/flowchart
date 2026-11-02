export interface SaveCapture<Snapshot> {
  version: number
  snapshot: Snapshot
}

export async function saveUntilCurrent<Snapshot, Result>(
  capture: () => SaveCapture<Snapshot>,
  send: (snapshot: Snapshot) => Promise<Result>,
  commit: (result: Result, version: number) => void,
  isCurrent: (version: number) => boolean,
) {
  let result: Result
  let version: number
  do {
    const current = capture()
    version = current.version
    result = await send(current.snapshot)
    commit(result, version)
  } while (!isCurrent(version))
  return result
}
