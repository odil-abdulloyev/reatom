import { next } from '@vercel/edge'
import { sql } from '@vercel/postgres'

const IS_DEV = process.env.VERCEL_ENV === 'development'

export default async function middleware(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const shouldLog =
    req.headers.get('accept')?.includes('text/html') &&
    (url.origin.endsWith('reatom.dev') || IS_DEV)

  if (shouldLog) {
    try {
      const created_at = new Date().toISOString()
      const path = url.pathname

      console.time('sql create table')
      await sql`
        create table if not exists logs (
          id bigint generated by default as identity not null,
          created_at timestamp with time zone null,
          path text null,
          constraint logs_pkey primary key (id)
        );
      `
      console.timeEnd('sql create table')

      console.time('sql insert')
      await sql`
        insert into logs
          (created_at, path)
          values (${created_at}, ${path})
      `
      console.timeEnd('sql insert')
    } catch (error) {
      console.error(error)
    }
  }

  return next()
}

export const getLogs = async (from: string, to: string) => {
  const { rows } = await sql<{ created_at: string; path: string }>`
    select * from logs
    where created_at >= ${from} and created_at <= ${to}
  `

  let lastHour: Date

  return rows.reduce<
    Array<{
      date: string
      counts: Record<string, number>
    }>
  >((acc, { created_at, path }) => {
    if (acc.length === 0 || Date.parse(created_at) > +lastHour) {
      lastHour = new Date(created_at)
      lastHour.setSeconds(0)
      lastHour.setMinutes(0)
      lastHour.setHours(lastHour.getHours() + 1)
      acc.push({ date: lastHour.toISOString(), counts: {} })
    }
    const { counts } = acc.at(-1)!
    counts[path] = (counts[path] ?? 0) + 1

    return acc
  }, [])
}