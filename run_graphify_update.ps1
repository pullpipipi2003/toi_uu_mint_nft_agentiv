# run_graphify_update.ps1 — Incremental update
$PY = Get-Content graphify-out\.graphify_python
& $PY scratch\graphify_pipeline.py --update @args
