from __future__ import annotations

import argparse
import json
import sys

from clipsmith import __version__
from clipsmith.bundle import BundleRepository
from clipsmith.capture import finalize_capture_job, start_capture_job
from clipsmith.errors import ClipsmithError
from clipsmith.installation import (
    InstallOptions,
    doctor_checks,
    doctor_exit_code,
    doctor_json,
    install_skills,
    print_doctor,
)
from clipsmith.providers import ProviderInfo, ProviderRegistry
from clipsmith.sinks import DirectorySink, InboxSink


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="clipsmith")
    parser.add_argument("--version", action="store_true", help="Print version and exit")
    subparsers = parser.add_subparsers(dest="command")

    capture_parser = subparsers.add_parser("capture", help="Manage local capture jobs")
    capture_subparsers = capture_parser.add_subparsers(dest="capture_command")

    start_parser = capture_subparsers.add_parser(
        "start", help="Create a pending capture job"
    )
    start_parser.add_argument("target")
    start_parser.add_argument("--provider")
    start_parser.add_argument("--state-dir")

    finalize_parser = capture_subparsers.add_parser(
        "finalize", help="Finalize a capture job with a bundle"
    )
    finalize_parser.add_argument("job_id_or_path")
    finalize_parser.add_argument("bundle_path")
    finalize_parser.add_argument("--state-dir")

    providers_parser = subparsers.add_parser(
        "providers", help="List available capture providers"
    )
    providers_parser.add_argument(
        "--json", action="store_true", help="Print providers as JSON"
    )

    validate_parser = subparsers.add_parser(
        "validate-bundle", help="Validate a capture bundle"
    )
    validate_parser.add_argument("bundle_path")
    validate_parser.add_argument(
        "--json", action="store_true", help="Print validation issues as JSON"
    )

    sink_parser = subparsers.add_parser(
        "sink", help="Export a capture bundle to a sink"
    )
    sink_subparsers = sink_parser.add_subparsers(dest="sink_command")

    directory_parser = sink_subparsers.add_parser(
        "directory", help="Copy a bundle to an output directory"
    )
    directory_parser.add_argument("bundle_path")
    directory_parser.add_argument("output_dir")
    directory_parser.add_argument(
        "--json", action="store_true", help="Print sink result as JSON"
    )

    inbox_parser = sink_subparsers.add_parser(
        "inbox", help="Copy a bundle to a filesystem inbox"
    )
    inbox_parser.add_argument("bundle_path")
    inbox_parser.add_argument("workspace")
    inbox_parser.add_argument(
        "--json", action="store_true", help="Print sink result as JSON"
    )

    install_parser = subparsers.add_parser(
        "install", help="Install Clipsmith skills into local agent targets"
    )
    _add_install_options(install_parser)

    uninstall_parser = subparsers.add_parser(
        "uninstall", help="Remove Clipsmith skill links from local agent targets"
    )
    _add_install_options(uninstall_parser)

    doctor_parser = subparsers.add_parser(
        "doctor", help="Check local Clipsmith runtime dependencies"
    )
    doctor_parser.add_argument(
        "--json", action="store_true", help="Print checks as JSON"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.version:
        print(f"clipsmith {__version__}")
        return 0
    try:
        if args.command == "capture":
            return _handle_capture(args)
        if args.command == "providers":
            return _handle_providers(args)
        if args.command == "validate-bundle":
            return _handle_validate_bundle(args)
        if args.command == "sink":
            return _handle_sink(args)
        if args.command == "install":
            return _handle_install(args)
        if args.command == "uninstall":
            return _handle_uninstall(args)
        if args.command == "doctor":
            return _handle_doctor(args)
    except ClipsmithError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    parser.print_help()
    return 0


def entrypoint() -> None:
    raise SystemExit(main())


def _handle_capture(args: argparse.Namespace) -> int:
    if args.capture_command == "start":
        job = start_capture_job(
            args.target, provider=args.provider, state_dir=args.state_dir
        )
    elif args.capture_command == "finalize":
        job = finalize_capture_job(
            args.job_id_or_path, args.bundle_path, state_dir=args.state_dir
        )
    else:
        print("clipsmith capture requires a subcommand", file=sys.stderr)
        return 2

    print(json.dumps(job.to_json_dict(), ensure_ascii=False))
    return 0


def _handle_providers(args: argparse.Namespace) -> int:
    providers = ProviderRegistry.default().list()
    if args.json:
        print(
            json.dumps(
                [_provider_to_dict(provider) for provider in providers],
                ensure_ascii=False,
            )
        )
        return 0

    print("name\tmode\tskill\tdomains")
    for provider in providers:
        domains = ", ".join(provider.domains)
        print(f"{provider.name}\t{provider.mode.value}\t{provider.skill}\t{domains}")
    return 0


def _handle_validate_bundle(args: argparse.Namespace) -> int:
    issues = BundleRepository().validate(args.bundle_path)
    if args.json:
        print(json.dumps({"issues": issues}, ensure_ascii=False))
    elif issues:
        print("kind\tpath\tmessage")
        for issue in issues:
            print(f"{issue['kind']}\t{issue['path']}\t{issue['message']}")
    else:
        print("Bundle is valid")
    return 1 if issues else 0


def _handle_sink(args: argparse.Namespace) -> int:
    if args.sink_command == "directory":
        result = DirectorySink(args.output_dir).write(args.bundle_path)
    elif args.sink_command == "inbox":
        result = InboxSink(args.workspace).write(args.bundle_path)
    else:
        print("clipsmith sink requires a subcommand", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f"{result['status']}: {result['path']}")
    return 0


def _handle_install(args: argparse.Namespace) -> int:
    for line in install_skills(_install_options(args, action="install")):
        print(line)
    return 0


def _handle_uninstall(args: argparse.Namespace) -> int:
    for line in install_skills(_install_options(args, action="uninstall")):
        print(line)
    return 0


def _handle_doctor(args: argparse.Namespace) -> int:
    checks = doctor_checks()
    if args.json:
        print(doctor_json(checks))
    else:
        for line in print_doctor(checks):
            print(line)
    return doctor_exit_code(checks)


def _add_install_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--claude", action="store_true", help="Target Claude Code skills only"
    )
    parser.add_argument("--codex", action="store_true", help="Target Codex skills only")
    parser.add_argument(
        "--all", action="store_true", help="Target both Claude Code and Codex"
    )
    parser.add_argument(
        "--copy", action="store_true", help="Copy skills instead of symlinking"
    )
    parser.add_argument("--only", help="Install/uninstall only comma-separated skills")
    parser.add_argument(
        "--skip", help="Install/uninstall all except comma-separated skills"
    )


def _install_options(args: argparse.Namespace, *, action: str) -> InstallOptions:
    return InstallOptions(
        action=action,
        claude=args.all or args.claude,
        codex=args.all or args.codex,
        copy=args.copy,
        only=args.only,
        skip=args.skip,
    )


def _provider_to_dict(provider: ProviderInfo) -> dict[str, object]:
    return {
        "name": provider.name,
        "mode": provider.mode.value,
        "skill": provider.skill,
        "domains": provider.domains,
    }
