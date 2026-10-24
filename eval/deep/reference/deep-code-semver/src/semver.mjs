const RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u

function parse(version) {
  const match = RE.exec(String(version))
  if (!match) throw new Error('invalid semver: ' + version)
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareIdentifiers(a, b) {
  const an = /^\d+$/u.test(a)
  const bn = /^\d+$/u.test(b)
  if (an && bn) return Math.sign(Number(a) - Number(b))
  if (an) return -1
  if (bn) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

export function compareVersions(a, b) {
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i += 1) {
    if (left.numbers[i] !== right.numbers[i]) return Math.sign(left.numbers[i] - right.numbers[i])
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let i = 0; i < length; i += 1) {
    if (left.prerelease[i] === undefined) return -1
    if (right.prerelease[i] === undefined) return 1
    const order = compareIdentifiers(left.prerelease[i], right.prerelease[i])
    if (order !== 0) return order
  }
  return 0
}
