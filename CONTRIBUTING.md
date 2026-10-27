# Contributing

Thanks for wanting to help. The project is early, so bug reports with clear steps and small fixes help most right now.

## Talk first

For a bug, open an issue with the bug template. For an idea or a bigger change, open an issue before writing code so we can agree on the approach. A pull request that arrives without a discussion might not fit the plan.

## Set up

Follow [Requirements](README.md#requirements) and [Run it](README.md#run-it) in the README. Before opening a pull request, run:

```sh
bun run check
```

It must pass. It runs the type checks, linting, formatting and every TypeScript and Rust test.

## How the code is laid out

[README.md](README.md#how-its-organized) has the tree, and [GLOSSARY.md](GLOSSARY.md) names things. Use those names in code, issues and pull requests. A few rules keep the code easy to change:

- Logic, state and looks live in separate files: `name.ts` is plain logic, `useName.ts` holds React state, and `Name.tsx` decides how it looks. Components never call Rust directly.
- Colors and sizes come only from the design tokens in `src/index.css`. ESLint rejects raw colors and pixel font sizes in class names.
- Rust stays small and handles only what needs the OS: capture, windows and files. Everything else goes in TypeScript.
- Shared types are generated. After changing a Rust type the frontend uses, run `bun run bindings` and commit `src/lib/bindings.ts`.

## Pull requests

- Keep each one to a single change, with a title that says what it does.
- Say how you tested it. Most changes need you to run the app, since screen capture can't run in CI.
- Don't commit recordings or anything from `temp/`.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), the same as the project. There's no CLA.
