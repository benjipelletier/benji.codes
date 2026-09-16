export interface ProjectConfig {
  name: string
  displayName: string
  icon: string
  accent: string
  accentRgb: string
  tagline: string
  description: string
  tags: string[]
  enabled: boolean
}

export const projects: ProjectConfig[] = [
  {
    name: 'riddleyu',
    displayName: '谜语日',
    icon: '谜',
    accent: '#c0392b',
    accentRgb: '192, 57, 43',
    tagline: 'riddleyu',
    description: 'A daily 成语 puzzle. Decode the ancient four-character idiom from cryptic clues — one chance each day.',
    tags: ['成语', 'daily', 'puzzle'],
    enabled: true,
  },
  {
    name: 'gecijielong',
    displayName: '歌词接龙',
    icon: '龙',
    accent: '#c9a96e',
    accentRgb: '201, 169, 110',
    tagline: 'gecijielong',
    description: 'Chain Mandarin song lyrics together. Each player continues where the last left off — a flowing dragon of verse.',
    tags: ['lyrics', 'chain', 'music'],
    enabled: true,
  },
  {
    name: 'jazz',
    displayName: '爵士和弦',
    icon: '♫',
    accent: '#5b8a72',
    accentRgb: '91, 138, 114',
    tagline: 'jazz',
    description: 'Explore jazz chord progressions through interactive real book analysis and harmonic visualization.',
    tags: ['jazz', 'music', 'chords'],
    enabled: true,
  },
]
