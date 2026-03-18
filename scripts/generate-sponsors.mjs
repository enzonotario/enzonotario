#!/usr/bin/env node
/**
 * generate-sponsors.mjs
 * Reads current GitHub sponsors and generates:
 *   - BACKERS.md
 *   - sponsors.png (via @takumi-rs/image-response)
 *
 * Customize via sponsors.config.json:
 *   overrides  – override fields (name, avatarUrl, url) for a GitHub sponsor by login
 *   extras     – additional sponsors not in GitHub Sponsors
 */

import { ImageResponse } from '@takumi-rs/image-response'
import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createElement } from 'react'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// 0. Load config
// ---------------------------------------------------------------------------

const CONFIG_PATH = resolve(process.cwd(), 'sponsors.config.json')
const config = existsSync(CONFIG_PATH)
  ? JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  : {}

const overrides = config.overrides ?? {}  // { [login]: { name?, avatarUrl?, url? } }
const extras    = config.extras    ?? []  // [{ login, name, avatarUrl, url?, monthlyAmount? }]

// ---------------------------------------------------------------------------
// 1. Fetch sponsors via GitHub CLI
// ---------------------------------------------------------------------------

async function fetchSponsors() {
  const query = `{
    viewer {
      sponsorshipsAsMaintainer(first: 100, activeOnly: true) {
        nodes {
          sponsorEntity {
            ... on User { login name avatarUrl }
            ... on Organization { login name avatarUrl }
          }
          tier { monthlyPriceInDollars }
        }
      }
    }
  }`

  const raw = execSync(`gh api graphql -f query='${query}'`).toString()
  const data = JSON.parse(raw)

  const fromGitHub = data.data.viewer.sponsorshipsAsMaintainer.nodes.map(node => ({
    login: node.sponsorEntity.login,
    name: node.sponsorEntity.name || node.sponsorEntity.login,
    avatarUrl: node.sponsorEntity.avatarUrl,
    url: `https://github.com/${node.sponsorEntity.login}`,
    monthlyAmount: node.tier?.monthlyPriceInDollars ?? 0,
  }))

  // Apply overrides — a single object replaces the entry; an array splits it into multiple
  const merged = fromGitHub.flatMap(s => {
    const ov = overrides[s.login]
    if (!ov) return [s]
    const entries = Array.isArray(ov) ? ov : [ov]
    return entries.map(entry => ({
      ...s,
      avatarUrlOriginal: s.avatarUrl,  // keep GitHub avatar as fallback
      name: entry.name ?? s.name,
      avatarUrl: entry.avatarUrl ?? s.avatarUrl,
      url: entry.url ?? s.url,
    }))
  })

  // Append extras
  const all = [
    ...merged,
    ...extras.map(e => ({
      login: e.login,
      name: e.name,
      avatarUrl: e.avatarUrl,
      url: e.url ?? `https://github.com/${e.login}`,
      monthlyAmount: e.monthlyAmount ?? 0,
    })),
  ]

  return all.sort((a, b) => b.monthlyAmount - a.monthlyAmount)
}

// ---------------------------------------------------------------------------
// 2. Generate BACKERS.md
// ---------------------------------------------------------------------------

function generateBackersMd(sponsors) {
  const header = `# Backers

Thank you to all my sponsors! Your support keeps this work going. 🙏

> Sponsor me at [github.com/sponsors/enzonotario](https://github.com/sponsors/enzonotario)

<!-- sponsors -->
`

  const rows = sponsors
    .map(
      s =>
        `| [![${s.name}](${s.avatarUrl}&s=80)](${s.url}) |\n| :---: |\n| [${s.name}](${s.url}) |`,
    )
    .join('\n\n')

  const footer = `\n<!-- /sponsors -->\n`

  return header + rows + footer
}

// ---------------------------------------------------------------------------
// 3. Fetch image as base64 data URL (takumi needs embeddable images)
// ---------------------------------------------------------------------------

async function toDataUrl(url, fallbackUrl) {
  const urls = [url, fallbackUrl].filter(Boolean)
  for (const u of urls) {
    const fetchUrl = u.includes('avatars.githubusercontent.com') ? `${u}&s=96` : u
    try {
      const res = await fetch(fetchUrl)
      if (!res.ok) { console.warn(`  ⚠️  Could not fetch image (${res.status}): ${u}`); continue }
      const buf = await res.arrayBuffer()
      const mime = res.headers.get('content-type') || 'image/png'
      return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`
    } catch {
      console.warn(`  ⚠️  Could not fetch image: ${u}`)
    }
  }
  throw new Error(`All image URLs failed for: ${url}`)
}

// ---------------------------------------------------------------------------
// 4. Generate sponsors.png via takumi
// ---------------------------------------------------------------------------

async function generateImage(sponsors) {
  const AVATAR_SIZE = 72
  const CARD_WIDTH  = 110
  const COLS        = Math.min(sponsors.length, 6)
  const WIDTH       = Math.max(600, COLS * (CARD_WIDTH + 28) + 80)
  const ROWS        = Math.ceil(sponsors.length / COLS)
  const HEIGHT      = 130 + ROWS * (AVATAR_SIZE + 72) + 32

  const sponsorsWithData = await Promise.all(
    sponsors.map(async s => ({ ...s, dataUrl: await toDataUrl(s.avatarUrl, s.avatarUrlOriginal) })),
  )

  const response = new ImageResponse(
    createElement(
      'div',
      {
        tw: 'flex flex-col items-center w-full h-full bg-white',
        style: { fontFamily: 'sans-serif', padding: '40px 40px 32px' },
      },
      // Title
      createElement(
        'div',
        { tw: 'flex items-center mb-8', style: { gap: 10 } },
        createElement(
          'svg',
          { width: 28, height: 28, viewBox: '0 0 24 24', fill: '#e11d48' },
          createElement('path', { d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' }),
        ),
        createElement('span', { style: { fontSize: 28, fontWeight: 700, color: '#111827' } }, 'Sponsors & Backers'),
      ),
      // Grid
      createElement(
        'div',
        { tw: 'flex flex-wrap justify-center', style: { gap: '24px 28px' } },
        ...sponsorsWithData.map(s =>
          createElement(
            'div',
            {
              key: s.login,
              tw: 'flex flex-col items-center',
              style: { width: CARD_WIDTH, gap: 8 },
            },
            createElement('img', {
              src: s.dataUrl,
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              style: { borderRadius: '50%', border: '2px solid #e5e7eb' },
            }),
            createElement(
              'span',
              {
                style: {
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#374151',
                  textAlign: 'center',
                  lineHeight: 1.4,
                  width: '100%',
                  wordBreak: 'break-word',
                },
              },
              s.name,
            ),
          ),
        ),
      ),
    ),
    { width: WIDTH, height: HEIGHT, format: 'png' },
  )

  const buffer = await response.arrayBuffer()
  writeFileSync('sponsors.png', Buffer.from(buffer))
  console.log(`✅  sponsors.png  (${WIDTH}×${HEIGHT})`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const sponsors = await fetchSponsors()

if (sponsors.length === 0) {
  console.log('No active sponsors found.')
  process.exit(0)
}

console.log(`Found ${sponsors.length} sponsor(s):`)
sponsors.forEach(s => console.log(`  · ${s.name} (@${s.login})  $${s.monthlyAmount}/mo`))

writeFileSync('BACKERS.md', generateBackersMd(sponsors))
console.log('✅  BACKERS.md')

await generateImage(sponsors)
