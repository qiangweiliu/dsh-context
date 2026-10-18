/** Load client.js in the same mock browser shell used by static/smoke tests. */
export function loadClient(clientSource, { trackEffects = false, onConfigForms } = {}) {
  let registration
  const dictionaries = {}
  const effects = []
  const slotInjects = []
  const slotRegistrations = []
  const react = {
    createElement: () => null,
    Fragment: Symbol('Fragment'),
    useState: () => [null, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
  const require = (specifier) => {
    if (specifier === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(specifier)})`)
  }
  const fakeWindow = {
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
  }
  new Function('window', 'require', clientSource)(fakeWindow, require)
  const moduleExports = registration.factory(require)
  const ctx = {
    effect(execute, label) {
      if (trackEffects) effects.push({ label, dispose: execute() })
      else execute()
    },
    locale: {
      register(namespace, values) {
        dictionaries[namespace] = values
        return () => delete dictionaries[namespace]
      },
      bind(namespace) {
        return (key) => dictionaries[namespace]?.zh?.[key] ?? dictionaries[namespace]?.en?.[key] ?? key
      },
    },
    slots: {
      inject(name, callback) {
        slotInjects.push({ name, callback })
      },
      register(definition, component) {
        slotRegistrations.push({ definition, component })
        return () => {}
      },
    },
  }
  if (onConfigForms) {
    ctx.configForms = {
      get() {
        onConfigForms()
        return null
      },
    }
  }
  moduleExports.apply(ctx)
  return { registration, moduleExports, dictionaries, effects, slotInjects, slotRegistrations }
}
