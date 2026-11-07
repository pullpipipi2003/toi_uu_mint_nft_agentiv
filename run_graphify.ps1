# run_graphify.ps1 — Full rebuild
# Chạy từ thư mục project (chứa .graphifyignore và graphify-out/)
$PY = Get-Content graphify-out\.graphify_python
& $PY scratch\graphify_pipeline.py @args
