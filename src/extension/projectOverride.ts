let _overrideRoot: string | null = null

export function getOverrideRoot(): string | null {
  return _overrideRoot
}

export function setOverrideRoot(root: string | null): void {
  _overrideRoot = root
}
