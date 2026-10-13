- `ax-babysit-prs`: new optional `ci.post_deploy_checks` key (repo name to skill name, off by
  default). Once a deploy is confirmed for a PR's head, the loop runs that repo's deploy-observability
  skill and reports the PR as not ready to merge until the check ran clean on the head
  (`last_post_deploy_check_sha` in the state file).
