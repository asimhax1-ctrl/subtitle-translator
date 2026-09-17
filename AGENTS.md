# Subtitle Translator — Arabic-first Fork

## Project Identity

This fork of `subtitle-translator` is intentionally **Arabic-first**. Its primary purpose is to produce professional-quality Arabic subtitles for movies, TV series, and anime. Every change must first protect and improve Arabic output; other languages are supported but not at the expense of Arabic quality.

## Arabic Quality Requirements (Non-negotiable)

The final Arabic output must be:

- Natural **Modern Standard Arabic** (MSA), not literal machine translation.
- Grammatically correct, including gender/number agreement and correct verb forms.
- Contextually accurate: the same line must change meaning when the scene, relationship, or speaker changes.
- Cinematic and concise: subtitle-friendly length and flow.
- Consistent across the entire movie, episode, or season.

### Specific Focus Areas

1. **Names and transliteration**
   - Character names must be rendered consistently across all batches.
   - Transliteration must follow common Arabic conventions, not phonetic chaos.
   - Real-world example: "Signore" must not blindly become "يا رب"; depending on context it may mean "سيدي" or another appropriate equivalent.

2. **Titles and honorifics**
   - Mr./Mrs./Sir/Madam/Captain/Doctor/etc. must match the social relationship shown on screen.
   - Anime honorifics (-san, -kun, -chan, -sama, senpai, sensei) must be handled contextually, not translated literally.

3. **Recurring terminology and glossary enforcement**
   - The user-supplied glossary is mandatory.
   - Terms not in the glossary but repeated across a work should still be kept consistent.

4. **Terminology memory across batches**
   - Context-aware batching already gives the model surrounding lines.
   - Additional mechanisms should remember names/terms discovered earlier in the same work.

5. **Speaker identity**
   - Where speaker identity can be inferred (repeated lines, scene context, gender cues), Arabic gender/verb agreement must follow it.

6. **Gender and pronouns**
   - Arabic verbs/adjectives must agree with the intended gender of the speaker or referent.
   - Pronouns must not default to masculine when the source implies feminine.

7. **Surrounding dialogue and context**
   - Lines must be translated with preceding and following dialogue in mind.
   - Replies must make sense as replies.

8. **Idioms, jokes, sarcasm and implied meaning**
   - Literal translation of jokes/idioms is a bug.
   - Sarcasm must be preserved and readable in Arabic.

9. **Mixed-language dialogue**
   - English, Italian, German, French, Japanese, Latin, etc. words or phrases embedded in source dialogue must be handled intentionally:
     - Usually preserved or transliterated, not silently translated into a different foreign language.
     - Context decides: a German military term, an Italian greeting, a Japanese honorific, or a Latin spell each have different expectations.

10. **Detecting accidentally untranslated source text**
    - A line that still contains the original source text (or large fragments of it) is a bug.
    - Detection and repair must happen automatically.

11. **Arabic punctuation and RTL**
    - Output should use Arabic-appropriate punctuation when it improves readability.
    - Mixed Arabic/Latin text should render correctly.
    - ASS/SRT/VTT/LRC structures and timestamps must never be altered.

12. **Preventing hallucinated, missing or duplicated dialogue**
    - Existing structural guards (marker extraction, merge/echo detection) must be preserved.
    - Arabic-specific semantic checks should be added where possible without breaking structural integrity.

13. **Subtitle structure, timestamps and ASS/SRT/VTT/LRC integrity**
    - Timecodes, cue numbers, ASS headers/styles, and VTT metadata are sacred.
    - Only dialogue text is sent to the translation engine.

14. **Token efficiency**
    - Optimize prompts and batching only when translation quality is not reduced.
    - Never weaken a safeguard to save tokens.

## Branch Policy

- Default branch for this fork: `ai/arabic-first`.
- Do **not** merge to `main` without explicit approval.
- Do **not** force-push to `origin/ai/arabic-first`.
- Every behavioral change must be verified by a regression test, `yarn test`, `yarn lint`, and `yarn build`.

## Development Workflow

For every behavioral change:

1. Inspect the existing implementation.
2. Reproduce the problem with a failing regression test (synthetic data, never full copyrighted subtitle files).
3. Confirm the test fails for the expected reason.
4. Implement the smallest robust fix.
5. Run `yarn test`.
6. Run `yarn lint`.
7. Run `yarn build`.
8. Review `git diff`.
9. Commit the verified change.
10. Push to `origin/ai/arabic-first`.
11. Continue to the next verified issue.

## Coding Conventions

- Match the existing TypeScript style (Chinese comments are preserved where they exist; add English or Arabic comments for new Arabic-specific logic).
- Keep business logic in separate pure modules under `src/app/lib/translation/`.
- Never hardcode API keys, passwords, or tokens.
- Validate and sanitize all user inputs before processing.
- Use `async/await` with `try/catch` for all I/O and network operations.
- Prefer explicit, readable code over clever code.

## Testing Conventions

- Add regression tests in `*.test.ts` files alongside the code they verify.
- Use synthetic subtitle lines, not copyrighted movie scripts.
- Tests must run with `yarn test` (Vitest).
- A failing test must be committed only when it demonstrates a real, reproducible bug that the next commit fixes.

## When to Ask

- If a requirement conflicts with an existing test or safeguard, flag it before weakening anything.
- If a change would affect non-Arabic languages, review whether it is safely gated on the target language.
