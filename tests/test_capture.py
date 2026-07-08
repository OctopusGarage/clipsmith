import json
from pathlib import Path

import pytest

from clipsmith.capture import CaptureError, finalize_capture_job, start_capture_job
from clipsmith.cli import main


FIXTURES = Path(__file__).parent / "fixtures"


def test_start_capture_job_infers_provider_and_persists_metadata(tmp_path):
    job = start_capture_job(
        "https://www.xiaohongshu.com/explore/abc",
        state_dir=tmp_path / "state",
    )

    assert job.target == "https://www.xiaohongshu.com/explore/abc"
    assert job.provider == "xhs"
    assert job.status == "pending"
    assert job.job_path == tmp_path / "state" / "jobs" / job.job_id

    payload = json.loads((job.job_path / "job.json").read_text(encoding="utf-8"))
    assert payload["job_id"] == job.job_id
    assert payload["provider"] == "xhs"
    assert payload["status"] == "pending"


def test_start_capture_job_ids_are_unique_for_fast_repeated_jobs(tmp_path):
    first = start_capture_job("https://example.com/article", state_dir=tmp_path)
    second = start_capture_job("https://example.com/article", state_dir=tmp_path)

    assert first.job_id != second.job_id
    assert first.job_path != second.job_path
    assert first.job_path.is_dir()
    assert second.job_path.is_dir()


def test_finalize_capture_job_validates_bundle_and_marks_job_done(tmp_path):
    job = start_capture_job("https://x.com/example/status/123", state_dir=tmp_path)

    updated = finalize_capture_job(
        job.job_id, FIXTURES / "valid-xhs-bundle", state_dir=tmp_path
    )

    assert updated.job_id == job.job_id
    assert updated.status == "done"
    assert updated.bundle_path == FIXTURES / "valid-xhs-bundle"

    payload = json.loads((updated.job_path / "job.json").read_text(encoding="utf-8"))
    assert payload["status"] == "done"
    assert payload["bundle_path"] == str(FIXTURES / "valid-xhs-bundle")


def test_finalize_capture_job_rejects_invalid_bundle(tmp_path):
    job = start_capture_job("https://x.com/example/status/123", state_dir=tmp_path)

    with pytest.raises(CaptureError, match="Bundle validation failed"):
        finalize_capture_job(
            job.job_id, FIXTURES / "invalid-missing-summary", state_dir=tmp_path
        )

    payload = json.loads((job.job_path / "job.json").read_text(encoding="utf-8"))
    assert payload["status"] == "pending"
    assert "bundle_path" not in payload


@pytest.mark.parametrize("job_id", ["../outside/job", "/tmp/clipsmith-outside-job"])
def test_finalize_capture_job_rejects_unsafe_plain_job_ids(tmp_path, job_id):
    with pytest.raises(CaptureError, match="Unsafe capture job id"):
        finalize_capture_job(job_id, FIXTURES / "valid-xhs-bundle", state_dir=tmp_path)


def test_finalize_capture_job_ignores_tampered_job_path_metadata(tmp_path):
    job = start_capture_job("https://x.com/example/status/123", state_dir=tmp_path)
    outside = tmp_path / "outside"
    job_json = job.job_path / "job.json"
    payload = json.loads(job_json.read_text(encoding="utf-8"))
    payload["job_path"] = str(outside)
    job_json.write_text(json.dumps(payload), encoding="utf-8")

    updated = finalize_capture_job(
        job.job_id, FIXTURES / "valid-xhs-bundle", state_dir=tmp_path
    )

    assert updated.job_path == job.job_path
    assert not outside.exists()
    persisted = json.loads(job_json.read_text(encoding="utf-8"))
    assert persisted["job_path"] == str(job.job_path)
    assert persisted["status"] == "done"


def test_capture_cli_start_and_finalize_print_json(tmp_path, capsys):
    code = main(
        [
            "capture",
            "start",
            "https://mp.weixin.qq.com/s/example",
            "--state-dir",
            str(tmp_path),
        ]
    )
    start_output = json.loads(capsys.readouterr().out)

    assert code == 0
    assert start_output["provider"] == "wechat"
    assert start_output["status"] == "pending"

    code = main(
        [
            "capture",
            "finalize",
            start_output["job_id"],
            str(FIXTURES / "valid-xhs-bundle"),
            "--state-dir",
            str(tmp_path),
        ]
    )
    finalize_output = json.loads(capsys.readouterr().out)

    assert code == 0
    assert finalize_output["job_id"] == start_output["job_id"]
    assert finalize_output["status"] == "done"
