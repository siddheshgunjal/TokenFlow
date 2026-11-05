# Pull Request Template

## Summary and Linked Issue

- **Summary**: <description of the changes>
- **Linked Issue**: <issue number or "none">

## Test Plan

- **Test plan**: <description of how changes are tested>
- **Test results**: <results of test runs>

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `cargo fmt --check` passes
- [ ] `cargo clippy --all-targets -- -D warnings` passes
- [ ] `cargo test` passes
- [ ] Documentation updated (if applicable)
- [ ] No secrets or `.env` values committed
- [ ] Screenshots/GIF included for UI changes (if applicable)
