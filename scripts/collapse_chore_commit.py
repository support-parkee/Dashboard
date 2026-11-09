#!/usr/bin/env python3
"""
Ensure the repository history contains at most ONE single 'chore(auto-sync):' commit
at the very top (HEAD), keeping all code commits (feat/fix/perf/style/etc.) clean.
"""

import os
import subprocess
import sys
from datetime import datetime

SYNC_PATHS = [
    "data/fleet.json",
    "data/servers.json",
    "data/locations.json",
    "data/summary.json",
    "data/tickets.json",
    "data/tickets_summary.json",
    "data/server_backup.json",
    "data/server_backup_raw.json",
    "js/summary-data.js",
]


def run_git(args, input_bytes=None, env=None):
    res = subprocess.run(
        ["git"] + args,
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=True,
    )
    return res.stdout


def get_tree_entries(tree_sha):
    out = run_git(["ls-tree", "-r", tree_sha]).decode("utf-8")
    entries = {}
    for line in out.splitlines():
        if not line.strip():
            continue
        meta, path = line.split("\t", 1)
        mode, obj_type, sha = meta.split(" ")
        entries[path] = (mode, obj_type, sha)
    return entries


def replace_sync_paths_in_tree(base_tree_sha, parent_tree_sha):
    base_entries = get_tree_entries(base_tree_sha)
    parent_entries = get_tree_entries(parent_tree_sha)

    changed = False
    for p in SYNC_PATHS:
        if p in parent_entries and base_entries.get(p) != parent_entries[p]:
            base_entries[p] = parent_entries[p]
            changed = True

    if not changed:
        return base_tree_sha

    env = os.environ.copy()
    tmp_idx = os.path.abspath(".git/tmp_clean_index")
    if os.path.exists(tmp_idx):
        os.remove(tmp_idx)
    env["GIT_INDEX_FILE"] = tmp_idx

    run_git(["read-tree", base_tree_sha], env=env)
    for p in SYNC_PATHS:
        if p in parent_entries:
            mode, _, sha = parent_entries[p]
            run_git(["update-index", "--cacheinfo", f"{mode},{sha},{p}"], env=env)

    new_tree = run_git(["write-tree"], env=env).decode("utf-8").strip()
    if os.path.exists(tmp_idx):
        os.remove(tmp_idx)
    return new_tree


def parse_ident(line):
    lt = line.rfind("<")
    gt = line.rfind(">")
    return line[:lt].strip(), line[lt + 1 : gt].strip(), line[gt + 1 :].strip()


def is_chore_data_subject(subject):
    return (
        subject.startswith("chore(auto-sync):")
        or subject.startswith("chore(tickets):")
        or subject == "sync_fresh_glpi_tickets_20261023"
        or subject.startswith("data(ticketing): update tickets JSON")
    )


def main():
    commit_msg = (
        sys.argv[1]
        if len(sys.argv) > 1
        else f"chore(auto-sync): automated dataset & GLPI ticket sync at {datetime.now().strftime('%Y-%m-%d %H:%M:%S WIB')}"
    )
    if not commit_msg.endswith("\n"):
        commit_msg += "\n"

    # Stage current data files into index and write current target tree
    existing_sync = [p for p in SYNC_PATHS if os.path.exists(p)]
    if existing_sync:
        run_git(["add"] + existing_sync)
    target_head_tree = run_git(["write-tree"]).decode("utf-8").strip()

    # Single git log call for all commits in chronological order
    lines = run_git(["log", "--reverse", "--format=%H %s", "HEAD"]).decode("utf-8").splitlines()
    subjects = [tuple(line.split(" ", 1)) if " " in line else (line, "") for line in lines if line.strip()]

    chore_indices = [i for i, (_, s) in enumerate(subjects) if is_chore_data_subject(s)]

    if chore_indices == [len(subjects) - 1]:
        # HEAD is the only chore commit in history -> fast git commit --amend
        run_git(["commit", "--amend", "--allow-empty", "-m", commit_msg.strip()])
        print("[PASS] Amended existing single chore(auto-sync) commit at HEAD.")
        return

    # Otherwise, rebuild linear history stripping all old chore data commits
    # and placing the 1 single chore(auto-sync) commit at HEAD
    new_parent = None
    new_parent_tree = None
    last_chore_meta = None

    for sha, subj in subjects:
        raw = run_git(["cat-file", "commit", sha]).decode("utf-8", errors="replace")
        header, msg = raw.split("\n\n", 1)

        tree_sha = ""
        author_line = ""
        committer_line = ""
        for hline in header.splitlines():
            if hline.startswith("tree "):
                tree_sha = hline[5:].strip()
            elif hline.startswith("author "):
                author_line = hline[7:].strip()
            elif hline.startswith("committer "):
                committer_line = hline[10:].strip()

        if is_chore_data_subject(subj):
            last_chore_meta = (author_line, committer_line)
            continue

        clean_tree_sha = (
            replace_sync_paths_in_tree(tree_sha, new_parent_tree)
            if new_parent_tree is not None
            else tree_sha
        )

        a_name, a_email, a_date = parse_ident(author_line)
        c_name, c_email, c_date = parse_ident(committer_line)

        env = os.environ.copy()
        env["GIT_AUTHOR_NAME"] = a_name
        env["GIT_AUTHOR_EMAIL"] = a_email
        env["GIT_AUTHOR_DATE"] = a_date
        env["GIT_COMMITTER_NAME"] = c_name
        env["GIT_COMMITTER_EMAIL"] = c_email
        env["GIT_COMMITTER_DATE"] = c_date

        cmd = ["commit-tree", clean_tree_sha]
        if new_parent:
            cmd += ["-p", new_parent]

        new_parent = run_git(cmd, input_bytes=msg.encode("utf-8"), env=env).decode("utf-8").strip()
        new_parent_tree = clean_tree_sha

    # Append the 1 single chore(auto-sync) commit at the top with target_head_tree
    env = os.environ.copy()
    if last_chore_meta and len(sys.argv) <= 1:
        a_name, a_email, a_date = parse_ident(last_chore_meta[0])
        c_name, c_email, c_date = parse_ident(last_chore_meta[1])
        env["GIT_AUTHOR_NAME"] = a_name
        env["GIT_AUTHOR_EMAIL"] = a_email
        env["GIT_AUTHOR_DATE"] = a_date
        env["GIT_COMMITTER_NAME"] = c_name
        env["GIT_COMMITTER_EMAIL"] = c_email
        env["GIT_COMMITTER_DATE"] = c_date

    final_sha = run_git(
        ["commit-tree", target_head_tree, "-p", new_parent],
        input_bytes=commit_msg.encode("utf-8"),
        env=env,
    ).decode("utf-8").strip()

    run_git(["reset", "--soft", final_sha])
    print(f"[PASS] Consolidated history to 1 single chore(auto-sync) commit at HEAD ({final_sha[:7]}).")


if __name__ == "__main__":
    main()
