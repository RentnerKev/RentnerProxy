#!/bin/bash
set -Eeuo pipefail

verify_release_tag_revision() {
    local repository=$1 tag=$2 revision=$3 refs name object direct='' peeled=''
    [[ "$revision" =~ ^[a-f0-9]{40}$ ]] || return 1
    git check-ref-format "refs/tags/$tag" || return 1
    refs=$(GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c core.hooksPath=/dev/null ls-remote --exit-code "$repository" "refs/tags/$tag" "refs/tags/$tag^{}") || return 1
    while IFS=$'\t' read -r object name; do
        [[ "$object" =~ ^[a-f0-9]{40}$ ]] || return 1
        if [[ "$name" == "refs/tags/$tag" && -z "$direct" ]]; then direct=$object
        elif [[ "$name" == "refs/tags/$tag^{}" && -z "$peeled" ]]; then peeled=$object
        else return 1
        fi
    done <<< "$refs"
    [[ -n "$direct" && "${peeled:-$direct}" == "$revision" ]]
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
    : "${RELEASE_TAG:?}" "${REVISION:?}"
    verify_release_tag_revision https://github.com/RentnerKev/RentnerProxy.git "$RELEASE_TAG" "$REVISION" || {
        printf '%s\n' 'Release tag no longer targets the assessed source.' >&2
        exit 1
    }
fi
