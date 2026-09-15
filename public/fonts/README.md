# Bundled SIL OFL fonts

PDF Relief vendors these faces so text edits can embed a real TTF when
WinAnsi Standard 14 cannot encode the replacement (commas stay ASCII;
Latin Extended letters such as `Ł` do not). See PRIOR_ART #1.

| File | Family | License | Source |
| --- | --- | --- | --- |
| `LiberationSans-*.ttf` | Liberation Sans (metric-compatible with Arial / Helvetica) | SIL OFL 1.1 — `OFL-Liberation.txt` | [liberation-fonts 2.1.5](https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5) |
| `NotoSans-Regular.ttf` | Noto Sans (Latin / Greek / Cyrillic fallback) | SIL OFL 1.1 — `OFL-Noto.txt` | [notofonts/latin-greek-cyrillic](https://github.com/notofonts/latin-greek-cyrillic) |

Do not add AGPL/GPL font files. Subset at embed time via `@pdf-lib/fontkit`.
