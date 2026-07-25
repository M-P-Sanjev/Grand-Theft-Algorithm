'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export type StealthDisguise =
  | 'notes'
  | 'shopping'
  | 'planner'
  | 'recipe'
  | 'journal'
  | 'meeting'
  | 'expense'

const NOTE_KEY = 'safra_stealth_note_v1'

const DISGUISE_SEED: Record<
  StealthDisguise,
  { header: string; title: string; body: string }
> = {
  notes: {
    header: 'Personal Notes',
    title: 'Untitled',
    body: 'A few things to remember…\n\n',
  },
  shopping: {
    header: 'Personal Notes',
    title: 'Shopping List',
    body: '• Milk\n• Bread\n• Rice\n• Eggs\n• Soap\n• Toothpaste\n• Vegetables\n',
  },
  planner: {
    header: 'Personal Notes',
    title: 'Daily Planner',
    body: 'Morning\n• Quick stretch\n• Errands\n\nAfternoon\n• Call back\n• Pick up package\n\nEvening\n• Dinner prep\n',
  },
  recipe: {
    header: 'Personal Notes',
    title: 'Simple Dal',
    body: 'Ingredients\n• 1 cup lentils\n• 1 onion\n• 2 tomatoes\n• Spices\n\nSteps\n1. Rinse lentils\n2. Simmer 20 min\n3. Temper spices\n4. Serve warm\n',
  },
  journal: {
    header: 'Personal Notes',
    title: 'Journal',
    body: 'Today felt ordinary in a good way.\n\nGrateful for quiet evenings and warm tea.\n\n',
  },
  meeting: {
    header: 'Personal Notes',
    title: 'Meeting Notes',
    body: 'Attendees: A, B, C\n\nAgenda\n1. Timeline\n2. Budget\n3. Next steps\n\nAction items\n• Send summary\n• Schedule follow-up\n',
  },
  expense: {
    header: 'Personal Notes',
    title: 'Expenses',
    body: 'Groceries — 42.50\nTransit — 8.00\nCoffee — 4.25\n\nTotal — 54.75\n',
  },
}

function formatToday() {
  return new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

type Props = {
  disguise?: StealthDisguise
  isRecording?: boolean
  seconds?: number
  riskLabel?: string
  audioQuality?: string
  liveTranscript?: string
  transcriptLive?: boolean
  postError?: string
  onManualTranscript?: (text: string) => void
  onPanicExit: () => void
}

export function StealthShell({
  disguise = 'shopping',
  isRecording = true,
  seconds = 0,
  riskLabel = 'Analysing',
  audioQuality = 'Excellent',
  liveTranscript = '',
  transcriptLive = false,
  postError = '',
  onManualTranscript,
  onPanicExit,
}: Props) {
  const seed = DISGUISE_SEED[disguise] || DISGUISE_SEED.shopping
  const storageKey = `${NOTE_KEY}:${disguise}`

  const [title, setTitle] = useState(seed.title)
  const [body, setBody] = useState(seed.body)
  const [savedFlash, setSavedFlash] = useState(false)
  const [secretOpen, setSecretOpen] = useState(false)
  const [secretDraft, setSecretDraft] = useState('')

  const titleTaps = useRef(0)
  const bodyTaps = useRef(0)
  const titleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load autosaved note
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as { title?: string; body?: string }
        if (parsed.title) setTitle(parsed.title)
        if (parsed.body != null) setBody(parsed.body)
        return
      }
    } catch {
      /* ignore */
    }
    setTitle(seed.title)
    setBody(seed.body)
  }, [storageKey, seed.title, seed.body])

  // Autoselect wake lock while stealth is up (best-effort)
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const request = async () => {
      try {
        if ('wakeLock' in navigator) {
          lock = await navigator.wakeLock.request('screen')
        }
      } catch {
        /* platform may deny */
      }
    }
    void request()
    const onVis = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      void lock?.release()
    }
  }, [])

  const persist = useCallback(
    (nextTitle: string, nextBody: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify({ title: nextTitle, body: nextBody, at: Date.now() }),
          )
          setSavedFlash(true)
          setTimeout(() => setSavedFlash(false), 900)
        } catch {
          /* ignore */
        }
      }, 1800)
    },
    [storageKey],
  )

  useEffect(() => {
    persist(title, body)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [title, body, persist])

  const dateLabel = useMemo(() => formatToday(), [])

  function onTitlePointer() {
    titleTaps.current += 1
    if (titleTapTimer.current) clearTimeout(titleTapTimer.current)
    titleTapTimer.current = setTimeout(() => {
      titleTaps.current = 0
    }, 650)
    if (titleTaps.current >= 3) {
      titleTaps.current = 0
      bodyTaps.current = 0
      setSecretOpen(true)
    }
  }

  function onPagePointer(e: PointerEvent) {
    // Don't count taps that originate on the title (handled separately)
    const target = e.target as HTMLElement
    if (target.closest('[data-stealth-title]')) return
    if (target.closest('[data-stealth-secret]')) return

    bodyTaps.current += 1
    if (bodyTapTimer.current) clearTimeout(bodyTapTimer.current)
    bodyTapTimer.current = setTimeout(() => {
      bodyTaps.current = 0
    }, 650)
    if (bodyTaps.current >= 3) {
      bodyTaps.current = 0
      onPanicExit()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-[#F8F5EF] text-[#2a2622]"
      onPointerUp={onPagePointer}
    >
      <div className="mx-auto min-h-[100svh] w-full max-w-lg px-6 pb-16 pt-10 md:px-10">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <p className="text-[11px] tracking-[0.14em] text-[#8a847c] uppercase">
              {seed.header}
            </p>
            {/* Hidden sync / recording cue — looks like a syncing dot */}
            <span
              className="relative mt-0.5 inline-flex h-1.5 w-1.5"
              aria-hidden
              title=""
            >
              <span
                className={`absolute inline-flex h-full w-full rounded-full bg-[#c4bdb3] ${
                  isRecording ? 'animate-pulse' : 'opacity-40'
                }`}
              />
            </span>
            {savedFlash && (
              <span className="text-[10px] text-[#a39e96]">Saved</span>
            )}
          </div>
          <p className="text-[12px] text-[#8a847c]">{dateLabel}</p>
        </header>

        <div className="mt-10">
          <div className="relative" data-stealth-title>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => {
                e.stopPropagation()
                onTitlePointer()
              }}
              className="font-display w-full border-0 bg-transparent text-[2rem] leading-tight text-[#1f1c18] outline-none placeholder:text-[#c4bdb3] md:text-[2.35rem]"
              placeholder="Title"
              spellCheck
            />
            {/* Subtle title caret blink when syncing / recording */}
            {isRecording && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute top-2 -right-1 h-6 w-[1.5px] bg-[#1f1c18]/35"
                animate={{ opacity: [0.15, 0.7, 0.15] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            rows={14}
            spellCheck
            className="font-body mt-8 w-full resize-none border-0 bg-transparent text-[16px] leading-[1.75] text-[#3d3832] outline-none placeholder:text-[#b8b1a7]"
            placeholder="Start writing…"
          />

          {onManualTranscript ? (
            <div
              data-stealth-secret
              className="mt-6 border-t border-[#e8e2d8] pt-4"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <p className="text-[11px] tracking-[0.08em] text-[#a39e96] uppercase">
                Quick note
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={secretDraft}
                  onChange={(e) => setSecretDraft(e.target.value)}
                  onBlur={() => {
                    const t = secretDraft.trim()
                    if (t.length >= 4) {
                      onManualTranscript(t)
                      setSecretDraft('')
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const t = secretDraft.trim()
                      if (!t) return
                      onManualTranscript(t)
                      setSecretDraft('')
                    }
                  }}
                  placeholder="Add a line…"
                  className="min-w-0 flex-1 border-0 border-b border-[#e0d9cd] bg-transparent px-0 py-2 text-[15px] text-[#2a2622] outline-none placeholder:text-[#c4bdb3]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const t = secretDraft.trim()
                    if (!t) return
                    onManualTranscript(t)
                    setSecretDraft('')
                  }}
                  className="text-[12px] text-[#8a847c]"
                >
                  Add
                </button>
              </div>
              {postError ? (
                <p className="mt-2 text-[12px] text-rose-700">{postError}</p>
              ) : null}
              {transcriptLive ? (
                <p className="mt-2 text-[11px] text-emerald-700/80">Synced</p>
              ) : null}
              {liveTranscript ? (
                <p className="mt-2 text-[12px] text-[#6a645c] line-clamp-2">
                  Last: “{liveTranscript.slice(0, 100)}
                  {liveTranscript.length > 100 ? '…' : ''}”
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {secretOpen && (
          <motion.div
            data-stealth-secret
            className="fixed inset-0 z-[90] flex items-end justify-center bg-black/25 p-4 backdrop-blur-[2px] md:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSecretOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22 }}
              className="w-full max-w-sm rounded-2xl border border-[#e8e2d8] bg-[#FBF8F2] p-5 shadow-[0_12px_40px_rgba(40,30,20,0.12)]"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-display text-xl text-[#1f1c18]">Guardian Active</p>
              <dl className="mt-4 space-y-3 text-sm text-[#4a453e]">
                <div className="flex justify-between gap-4">
                  <dt className="text-[#8a847c]">Recording</dt>
                  <dd className="font-mono tabular-nums">
                    {isRecording ? fmt(seconds) : 'Paused'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#8a847c]">Audio Quality</dt>
                  <dd>{audioQuality}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#8a847c]">Encryption</dt>
                  <dd>Enabled</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#8a847c]">Risk</dt>
                  <dd>{riskLabel}</dd>
                </div>
                {liveTranscript ? (
                  <div>
                    <dt className="text-[#8a847c]">Last heard</dt>
                    <dd className="mt-1 text-[13px] leading-snug text-[#2a2622]">
                      “{liveTranscript.slice(0, 140)}
                      {liveTranscript.length > 140 ? '…' : ''}”
                    </dd>
                  </div>
                ) : null}
                {transcriptLive ? (
                  <p className="text-[11px] tracking-wide text-emerald-700/80 uppercase">
                    ● Transcript live
                  </p>
                ) : null}
                {postError ? (
                  <p className="text-[12px] text-rose-700">{postError}</p>
                ) : null}
              </dl>
              {onManualTranscript ? (
                <div className="mt-4 flex gap-2">
                  <input
                    value={secretDraft}
                    onChange={(e) => setSecretDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const t = secretDraft.trim()
                        if (!t) return
                        onManualTranscript(t)
                        setSecretDraft('')
                      }
                    }}
                    placeholder="Type what was said…"
                    className="min-w-0 flex-1 rounded-xl border border-[#e0d9cd] bg-white/70 px-3 py-2 text-xs text-[#2a2622] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const t = secretDraft.trim()
                      if (!t) return
                      onManualTranscript(t)
                      setSecretDraft('')
                    }}
                    className="rounded-xl border border-[#d4cdc0] px-3 py-2 text-[10px] tracking-[0.12em] text-[#4a453e] uppercase"
                  >
                    Send
                  </button>
                </div>
              ) : null}
              <p className="mt-5 text-[11px] text-[#a39e96]">Tap outside to hide</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export const STEALTH_DISGUISE_OPTIONS: { id: StealthDisguise; label: string }[] = [
  { id: 'notes', label: 'Notes' },
  { id: 'shopping', label: 'Shopping List' },
  { id: 'planner', label: 'Daily Planner' },
  { id: 'recipe', label: 'Recipe Book' },
  { id: 'journal', label: 'Journal' },
  { id: 'meeting', label: 'Meeting Notes' },
  { id: 'expense', label: 'Expense Tracker' },
]
