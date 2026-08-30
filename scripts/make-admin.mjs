#!/usr/bin/env node

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

let Database
try {
  const req = createRequire(import.meta.url)
  try {
    const adapterReq = createRequire(
      path.resolve(
        process.cwd(),
        'node_modules/@prisma/adapter-better-sqlite3/package.json',
      ),
    )
    Database = adapterReq('better-sqlite3')
  } catch {
    Database = req('better-sqlite3')
  }
} catch (e) {
  console.error('Failed to load better-sqlite3:', e)
  process.exit(1)
}

const email = process.argv[2]?.trim().toLowerCase()

if (!email) {
  console.error('Error: Please provide a user email address.')
  console.error('Usage: npm run make-admin <email>')
  process.exit(1)
}

let dbUrl = process.env.DATABASE_URL || 'file:./spliit.db'
let dbPath = dbUrl.replace(/^file:/, '')

// Handle host vs container paths gracefully
if (dbPath === '/data/spliit.db' && !fs.existsSync('/data')) {
  if (fs.existsSync('./spliit-data/spliit.db')) {
    dbPath = './spliit-data/spliit.db'
  } else if (fs.existsSync('./spliit.db')) {
    dbPath = './spliit.db'
  } else {
    dbPath = './spliit.db'
  }
}

const resolvedDbPath = path.isAbsolute(dbPath)
  ? dbPath
  : path.resolve(process.cwd(), dbPath)

let db
try {
  db = new Database(resolvedDbPath)

  const user = db
    .prepare('SELECT id, name, email, tier FROM User WHERE LOWER(email) = ?')
    .get(email)

  if (!user) {
    const id = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO User (id, email, tier, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
    ).run(id, email, 'admin', now, now)

    console.log(
      `✅ Successfully pre-authorized user (${email}) as Administrator! When they log in via OAuth, they will immediately have Admin permissions.`,
    )
  } else if (user.tier === 'admin') {
    console.log(
      `User ${user.name || ''} (${user.email}) is already an Administrator.`,
    )
  } else {
    db.prepare('UPDATE User SET tier = ? WHERE id = ?').run('admin', user.id)

    console.log(
      `✅ Successfully promoted user ${user.name || ''} (${user.email}) to Administrator tier!`,
    )
  }
} catch (err) {
  console.error('Error executing make-admin script:', err)
  process.exit(1)
} finally {
  if (db) {
    db.close()
  }
}
