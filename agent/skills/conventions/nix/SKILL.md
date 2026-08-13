---
name: nix
description: Nix expression guidance
injection: detect
detect:
  files: [flake.nix, default.nix, shell.nix]
---

- Follow existing Nix expression style (indentation, attribute ordering).
- Prefer nixpkgs conventions for package overrides and overlays.
- Keep flake inputs minimal; avoid unnecessary indirection.
- Test builds before switching when possible.
- Be explicit about system/platform dependencies.
- Before editing a dotfile on a declaratively managed machine, check whether it is a read-only symlink into the store. Writing to one fails, and the fix is to find the writable file that the managed chain sources — not to break the link.
