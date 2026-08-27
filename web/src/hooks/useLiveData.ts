import { liveQuery } from 'dexie'
import { useEffect, useState, type DependencyList } from 'react'

export function useLiveData<T>(query: () => Promise<T>, dependencies: DependencyList, initial: T): T {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({ next: setValue })
    return () => subscription.unsubscribe()
    // The caller owns dependency stability in the same way as useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
  return value
}
