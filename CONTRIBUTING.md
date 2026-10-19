# Contributing

Thanks for wanting to help. The project is early, so the most useful things right now are bug reports with clear steps, and small fixes.

## Talk first

- **Bugs:** open an issue with the bug template.
- **Ideas and bigger changes:** open an issue before writing code, so we can agree on the shape first. A pull request that lands without a discussion might not fit the plan.

## Set up

Follow [Requirements](README.md#requirements) and [Run it](README.md#run-it) in the README. Before opening a pull request, run:

```sh
bun run check
```

It must pass. It runs the type checks, linting, formatting and every test in TypeScript and Rust.

## How the code is laid out

[README.md](README.md#how-its-organized) has the tree, and [GLOSSARY.md](GLOSSARY.md) names things. Use those names in code, issues and pull requests. A few rules keep the code easy to change:

- **Logic, state and looks live in separate files:** `name.ts` is plain logic, `useName.ts` holds React state, and `Name.tsx` decides how it looks. Components never call Rust directly.
- **Colours and sizes come only from the design tokens** in `src/index.css`. ESLint rejects raw colours and pixel font sizes in class names.
- **Rust stays small.** It does what only the OS can: capture, windows and files. Logic that doesn't need the OS goes in TypeScript.
- **Shared types are generated.** After changing a Rust type the frontend uses, run `bun run bindings` and commit `src/lib/bindings.ts`.

## Pull requests

- Keep each one to a single change, with a title that says what it does.
- Say how you tested it. Most changes need you to run the app, since screen capture can't run in CI.
- Don't commit recordings or anything from `temp/`.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), the same as the project. There's no CLA.
