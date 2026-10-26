import { registerHooks } from "node:module";

/**
 * Node's native TypeScript stripping does not apply bundler-style extension
 * resolution. Tests use this narrow hook so production source can retain the
 * same extensionless relative imports consumed by Next.js and TypeScript.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.endsWith(".ts") &&
      specifier.startsWith(".") &&
      !/\.(?:[cm]?[jt]sx?|json|node)$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }

    return nextResolve(specifier, context);
  },
});
