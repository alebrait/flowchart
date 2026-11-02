import { describe, expect, it } from 'vitest'
import { saveUntilCurrent } from './saveSequencing'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('serialized saves', () => {
  it('saves newer edits only after the in-flight snapshot completes', async () => {
    const firstResponse = deferred<string>()
    let current = { version: 1, snapshot: 'first edit' }
    let activeRequests = 0
    let maximumConcurrentRequests = 0
    const sent: string[] = []
    const committed: string[] = []

    const save = saveUntilCurrent(
      () => current,
      async (snapshot) => {
        activeRequests += 1
        maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests)
        sent.push(snapshot)
        const response = snapshot === 'first edit' ? await firstResponse.promise : `saved ${snapshot}`
        activeRequests -= 1
        return response
      },
      (response) => committed.push(response),
      (version) => version === current.version,
    )

    current = { version: 2, snapshot: 'latest edit' }
    firstResponse.resolve('saved first edit')
    await expect(save).resolves.toBe('saved latest edit')

    expect(sent).toEqual(['first edit', 'latest edit'])
    expect(committed).toEqual(['saved first edit', 'saved latest edit'])
    expect(maximumConcurrentRequests).toBe(1)
  })

  it('propagates request failures without changing the current draft', async () => {
    const draft = { version: 1, snapshot: 'unsaved work' }

    await expect(
      saveUntilCurrent(
        () => draft,
        async () => {
          throw new Error('offline')
        },
        () => undefined,
        () => true,
      ),
    ).rejects.toThrow('offline')
    expect(draft.snapshot).toBe('unsaved work')
  })
})
