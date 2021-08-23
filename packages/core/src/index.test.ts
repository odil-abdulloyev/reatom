import { test } from 'uvu'
import * as assert from 'uvu/assert'

import {
  Atom,
  callSafety,
  Causes,
  createAtom,
  createStore,
  createTransaction,
  Fn,
  getState,
  Rec,
} from '@reatom/core'
import { createPrimitiveAtom } from '@reatom/core/primitives'
import { createPersist, init } from '@reatom/core/experiments'

import { mockFn, parseCauses, sleep } from '../test_utils'

test(`displayName`, () => {
  const firstNameAtom = createPrimitiveAtom(
    'John',
    {
      set: (state, name: string) => name,
    },
    `firstName`,
  )

  const lastNameAtom = createAtom(
    {},
    ($, state = 'Doe') => {
      return state
    },
    `lastName`,
  )

  const isFirstNameShortAtom = createAtom(
    { firstNameAtom },
    ({ get }) => get(`firstNameAtom`).length < 10,
    `isFirstNameShort`,
  )

  const fullNameAtom = createAtom(
    { firstNameAtom, lastNameAtom },
    ({ get }) => `${get(`firstNameAtom`)} ${get(`lastNameAtom`)}`,
    `fullName`,
  )

  const displayNameAtom = createAtom(
    { isFirstNameShortAtom, fullNameAtom, firstNameAtom },
    ({ get }) =>
      get(`isFirstNameShortAtom`) ? get(`fullNameAtom`) : get(`firstNameAtom`),
    `displayName`,
  )

  const store = createStore()

  const cb = mockFn()

  store.subscribe(displayNameAtom, cb)

  assert.is(cb.calls.length, 1)
  assert.is(cb.lastInput(), 'John Doe')

  store.dispatch(firstNameAtom.set('John'))
  assert.is(cb.calls.length, 1)
  assert.is(cb.lastInput(), 'John Doe')

  store.dispatch(firstNameAtom.set('Joe'))
  assert.is(cb.calls.length, 2)
  assert.is(cb.lastInput(), 'Joe Doe')

  store.dispatch(firstNameAtom.set('Joooooooooooooooooooe'))
  assert.is(cb.calls.length, 3)
  assert.is(cb.lastInput(), 'Joooooooooooooooooooe')

  store.dispatch(firstNameAtom.set('Joooooooooooooooooooe'))
  assert.is(cb.calls.length, 3)
  assert.is(cb.lastInput(), 'Joooooooooooooooooooe')
  ;`👍` //?
})

test(`combine`, () => {
  const aAtom = createPrimitiveAtom(0)
  const bAtom = createAtom({ aAtom }, ({ get }) => get(`aAtom`) % 2)
  const cAtom = createAtom({ aAtom }, ({ get }) => get(`aAtom`) % 2)
  const bcAtom = createAtom({ b: bAtom, c: cAtom }, ({ get }) => ({
    b: get(`b`),
    c: get(`c`),
  }))
  const store = createStore()

  init([bcAtom], store)

  const bsState1 = store.getCache(bcAtom)!.state
  assert.is(store.getCache(aAtom)!.state, 0)
  assert.equal(bsState1, { b: 0, c: 0 })

  store.dispatch(aAtom.change((s) => s + 1))
  const bsState2 = store.getCache(bcAtom)!.state
  assert.is(store.getCache(aAtom)!.state, 1)
  assert.equal(bsState2, { b: 1, c: 1 })

  store.dispatch(aAtom.change((s) => s + 2))
  const bsState3 = store.getCache(bcAtom)!.state
  assert.is(store.getCache(aAtom)!.state, 3)
  assert.equal(bsState3, { b: 1, c: 1 })
  assert.is(bsState2, bsState3)
  ;`👍` //?
})

test(`atom filter`, () => {
  const track = mockFn()
  const a1Atom = createPrimitiveAtom(0, null, `a1Atom`)
  const a2Atom = createPrimitiveAtom(0, null, `a2Atom`)
  const bAtom = createAtom({ a1Atom, a2Atom }, ({ get, onChange }, s = 0) => {
    track()

    const a = get(`a1Atom`)
    if (a % 2) s = a

    onChange(`a2Atom`, (v) => (s = v))

    return s
  })

  const bCache1 = bAtom(createTransaction([]))
  assert.is(track.calls.length, 1)
  assert.is(bCache1.state, 0)

  const bCache2 = bAtom(createTransaction([]), bCache1)
  assert.is(track.calls.length, 1)
  assert.equal(bCache1, bCache2)

  const bCache3 = bAtom(createTransaction([a1Atom.set(0)]), bCache2)
  assert.is(track.calls.length, 1)
  assert.equal(bCache2, bCache3)
  assert.equal(bCache3.state, 0)
  assert.equal(bCache2.state, bCache3.state)

  const bCache4 = bAtom(createTransaction([a1Atom.set(1)]), bCache3)
  assert.equal(track.calls.length, 2)
  assert.not.equal(bCache3, bCache4)
  assert.equal(bCache4.state, 1)
  assert.not.equal(bCache3.state, bCache4.state)

  const bCache5 = bAtom(
    createTransaction([a1Atom.change((s) => s + 2)]),
    bCache4,
  )
  assert.equal(track.calls.length, 3)
  assert.not.equal(bCache4, bCache5)
  assert.equal(bCache5.state, 3)
  assert.not.equal(bCache4.state, bCache5.state)
  ;`👍` //?
})

test(`in atom action effect`, async () => {
  function createResource<I, O>(
    fetcher: (params: I) => Promise<O>,
    id: string,
  ) {
    const resourceAtom = createAtom(
      {
        request: (payload: I) => payload,
        response: (payload: O | Error) => payload,
      },
      ({ create, onAction, schedule }, state = null as null | O | Error) => {
        onAction(`request`, (payload: I) => {
          schedule((dispatch) =>
            fetcher(payload)
              .then((data) => dispatch(create('response', data)))
              .catch((e) =>
                dispatch(
                  create('response', e instanceof Error ? e : new Error(e)),
                ),
              ),
          )
        })

        onAction(`response`, (payload: O | Error) => {
          state = payload
        })

        return state
      },
      id,
    )

    return resourceAtom
  }

  const dataAtom = createResource((params: void) => Promise.resolve([]), `data`)
  const cb = mockFn()

  const store = createStore()

  store.subscribe(dataAtom, cb)
  assert.is(cb.calls.length, 1)
  assert.is(cb.lastInput(), null)

  store.dispatch(dataAtom.request())
  assert.is(cb.calls.length, 1)
  await sleep()
  assert.is(cb.calls.length, 2)
  assert.equal(cb.lastInput(), [])

  assert.equal(parseCauses(cb.lastInput(1)), [
    'DISPATCH: data - request',
    'data - request handler',
    'DISPATCH: data - response',
    'data - response',
  ])
  ;`👍` //?
})

test(`Atom store dependency states`, () => {
  const aTrack = mockFn()
  const noopAction = () => ({ type: 'noop', payload: null })
  const aAtom = createAtom({ inc: () => null }, ({ onAction }, state = 1) => {
    aTrack()
    onAction(`inc`, () => (state += 1))
    return state
  })
  const bAtom = createAtom({ aAtom }, ({ get }) => get(`aAtom`) + 1)

  const bCache1 = bAtom(createTransaction([noopAction()]))
  assert.is(aTrack.calls.length, 1)

  const bCache2 = bAtom(createTransaction([noopAction()]), bCache1)
  assert.is(aTrack.calls.length, 1)
  assert.equal(bCache1, bCache2)

  assert.is(bCache2.state, 2)
  const bCache3 = bAtom(createTransaction([aAtom.inc()]), bCache1)
  assert.is(aTrack.calls.length, 2)
  assert.is(bCache3.state, 3)
  ;`👍` //?
})

test(`Atom from`, () => {
  const a = createPrimitiveAtom(42)

  assert.is(a(createTransaction([{ type: `noooop`, payload: null }])).state, 42)
  assert.is(a(createTransaction([a.set(43)])).state, 43)
  assert.is(a(createTransaction([a.change((s) => s + 2)])).state, 44)
  ;`👍` //?
})

test(`Persist`, () => {
  const snapshot: Rec = { TEST: 42 }
  const persist = createPersist({ get: (key) => snapshot[key] })
  const a = createPrimitiveAtom(0, null, {
    id: `TEST`,
    decorators: [persist()],
  })

  const { state } = a(createTransaction([]))

  assert.is(state, 42)
  ;`👍` //?
})

test(`Batched dispatch`, () => {
  const a = createPrimitiveAtom(0)
  const store = createStore()
  const cb = mockFn()

  store.subscribe(a, cb)

  assert.is(cb.calls.length, 1)

  store.dispatch([a.change((s) => s + 1), a.change((s) => s + 1)])
  assert.is(cb.calls.length, 2)
  assert.is(cb.lastInput(), 2)
  ;`👍` //?
})

test(`Manage dynamic dependencies`, () => {
  let reducerCalls = 0
  const a = createPrimitiveAtom(0)
  const b = createAtom(
    { add: (atom: Atom) => atom },
    (
      { onAction, getUnlistedState },
      state = new Array<readonly [Atom, any]>(),
    ) => {
      reducerCalls++

      onAction(
        `add`,
        (atom) => (state = [...state, [atom, getUnlistedState(atom)]]),
      )

      return state
    },
  )
  const store = createStore()

  init([b], store)
  assert.is(reducerCalls, 1)

  store.dispatch([b.add(a), a.set(1)])
  assert.equal(store.getCache(b)!.state, [[a, 1]])
  assert.is(reducerCalls, 2)
  ;`👍` //?
})

test(`await all effect`, async () => {
  let count = 0
  const subscriptions = new Set<Fn>()
  const callSafetyTracked: typeof callSafety = (...a: any[]) => {
    // @ts-expect-error
    const result: any = callSafety(...a)

    if (result instanceof Promise) {
      count++
      result.finally(() => {
        if (--count === 0) {
          subscriptions.forEach((cb) => cb())
        }
      })
    }

    return result
  }

  const resourceDataAtom = createPrimitiveAtom(0)
  const resourceAtom = createAtom(
    { resourceDataAtom, doA: () => null, doB: () => null },
    ({ create, get, onAction, schedule }) => {
      onAction(`doA`, () =>
        schedule(async (dispatch) => {
          await sleep(10)
          await dispatch(create(`doB`))
        }),
      )

      onAction(`doB`, () =>
        schedule(async (dispatch) => {
          await sleep(10)
          await dispatch(resourceDataAtom.change((s) => s + 1))
        }),
      )

      return get(`resourceDataAtom`)
    },
  )

  const store = createStore({ callSafety: callSafetyTracked })
  const cb = mockFn()

  init([resourceAtom], store)

  subscriptions.add(cb)

  store.dispatch(resourceAtom.doA())

  assert.is(cb.calls.length, 0)

  await sleep(10)

  assert.is(cb.calls.length, 0)

  await sleep(10)

  assert.is(cb.calls.length, 1)
  ;`👍` //?
})

test(`subscription to in-cache atom`, () => {
  const a = createPrimitiveAtom(0)
  const b = createAtom({ a }, ({ get }) => get(`a`))

  const trackA = mockFn()
  const trackB = mockFn()

  b.subscribe(trackB)

  assert.is(trackA.calls.length, 0)
  assert.is(trackB.calls.length, 1)

  a.change.dispatch((s) => s + 1)
  assert.is(trackB.calls.length, 2)

  a.subscribe(trackA)
  assert.is(trackA.calls.length, 1)
  assert.is(trackB.calls.length, 2)

  a.change.dispatch((s) => s + 1)
  assert.is(trackA.calls.length, 2)
  assert.is(trackB.calls.length, 3)
  ;`👍` //?
})

test(`getState of stale atom`, () => {
  const a = createPrimitiveAtom(0)
  const b = createAtom({ a }, ({ get }) => get(`a`))

  const store = createStore()

  const un = store.subscribe(b, () => {})

  assert.is(getState(a, store), 0)
  assert.is(getState(b, store), 0)

  store.dispatch(a.set(1))
  assert.is(getState(a, store), 1)
  assert.is(getState(b, store), 1)

  un()
  store.dispatch(a.set(2))
  assert.is(getState(a, store), 2)
  assert.is(getState(b, store), 2)
  ;`👍` //?
})

test(`subscription call cause`, () => {
  const counterAtom = createAtom(
    { inc: () => null, add: (v: number) => v },
    ({ onAction }, counter = 1) => {
      onAction(`inc`, () => counter++)
      onAction(`add`, (v) => (counter += v))
      return counter
    },
    `counter`,
  )
  const counterIsEvenAtom = createAtom(
    { counterAtom },
    ({ get }) => get(`counterAtom`) % 2 === 0,
    `counterIsEven`,
  )
  const counterIsHugeAtom = createAtom(
    { counterAtom },
    ({ get }) => get(`counterAtom`) > 10_000,
    `counterIsHuge`,
  )
  const titleAtom = createAtom(
    { counterIsEvenAtom, counterIsHugeAtom },
    ({ onChange }, title = 'counter') => {
      onChange(`counterIsEvenAtom`, () => (title = 'counter is even'))
      onChange(`counterIsHugeAtom`, () => (title = 'counter is huge'))
      return title
    },
    `title`,
  )

  const store = createStore()
  const cb = mockFn()

  store.subscribe(titleAtom, cb)

  store.dispatch(counterAtom.inc())
  assert.equal(parseCauses(cb.lastInput(1)), [
    'DISPATCH: counter - inc',
    'counterIsEven',
  ])

  store.dispatch(counterAtom.add(100_000))
  assert.equal(parseCauses(cb.lastInput(1)), [
    'DISPATCH: counter - add',
    'counterIsHuge',
  ])
  ;`👍` //?
})

test.run()