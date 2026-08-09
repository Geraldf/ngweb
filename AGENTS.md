# AI Agent Workflow Rules

You are an AI developer assisting with code changes in this repository. To maintain git history integrity and follow proper workflow hygiene, you MUST strictly adhere to the following rules regarding branching and commits.

---

## 1. Branch Management

* **Never commit directly to `main` or `master`.**
* **Check current branch:** Always inspect the current git branch before making any edits or running commands.
* **Create a feature branch:** If you are currently on `main` or `master`, create and switch to a new branch before making any code modifications.
* **Branch Naming Conventions:**
  * Features: `feat/short-description` (e.g., `feat/user-authentication`)
  * Bug fixes: `fix/short-description` (e.g., `fix/header-overflow`)
  * Documentation: `docs/short-description` (e.g., `docs/update-readme`)
  * Refactoring: `refactor/short-description` (e.g., `refactor/db-connection`)

---

## 2. Commit Message Standards

All commit messages must follow the **Conventional Commits** specification.

* **Format:** `<type>(<scope>): <short summary>`
* **Types:**
  * `feat`: A new feature
  * `fix`: A bug fix
  * `docs`: Documentation changes only
  * `style`: Code style/formatting changes (no logic changes)
  * `refactor`: Code changes that neither fix a bug nor add a feature
  * `test`: Adding or correcting tests
  * `chore`: Maintenance, dependencies, or build config updates
* **Rules:**
  * Write the summary in the imperative mood (e.g., "add feature" not "added feature").
  * Do not capitalize the first letter of the summary.
  * No period `.` at the end of the subject line.
  * Keep the first line under 72 characters.

---

## 3. Mandatory Execution Workflow

Follow this sequence for every change request:

1. **Check Status:** Run `git status` and `git branch --show-current`.
2. **Branch Check:** If on `main` or `master`, run `git checkout -b <type>/<description>`.
3. **Implement Changes:** Write and test the code changes.
4. **Stage Files:** Stage specific modified files using `git add <file>`, avoiding `git add .` unless explicitly intended.
5. **Commit:** Execute `git commit -m "<type>(<scope>): <description>"`.
