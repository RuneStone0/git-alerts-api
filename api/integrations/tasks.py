import time

import requests
from logging import getLogger
from celery import shared_task
from django.utils import timezone
from .models import UserIntegration

logger = getLogger(__name__)

# Distinguishing "the token is wrong" from "the network was down" matters: only the first
# should mark an integration as broken. Anything raised by requests before a response exists
# is retried, and if it still fails the caller is told it was the network, not the token.
TRANSIENT_ERROR_PREFIX = "Network error"
MAX_VALIDATION_ATTEMPTS = 3


def is_transient_error(error_message: str) -> bool:
    """True when a validation failure was a network problem rather than a rejected token."""
    return bool(error_message) and error_message.startswith(TRANSIENT_ERROR_PREFIX)

@shared_task
def run_validation_task(integration_id):
    """Celery task for performing integration token validation"""
    logger.info(
        f"event=celery_task_received task={run_validation_task.name} integration_id={integration_id}"
    )
    try:
        logger.info(
            f"event=integration_validation_started integration_id={integration_id}"
        )

        integration = UserIntegration.objects.get(id=integration_id)
        previous_status = integration.status
        integration.status = UserIntegration.Status.PENDING
        integration.save()

        if integration.provider == "github":
            is_valid, error_message = validate_github_integration(integration.get_token())

            if is_valid:
                integration.status = UserIntegration.Status.CONNECTED
                integration.error_message = ''
            elif is_transient_error(error_message):
                # Keep what we knew before: a DNS blip says nothing about the token's validity.
                integration.status = previous_status
                integration.error_message = error_message
            else:
                integration.status = UserIntegration.Status.FAILED
                integration.error_message = error_message

        elif integration.provider == "slack":
            if validate_slack_integration(integration.get_token()):
                integration.status = UserIntegration.Status.CONNECTED
                integration.error_message = ''
            else:
                integration.status = UserIntegration.Status.FAILED
                integration.error_message = 'Slack token validation failed'

        else:
            integration.status = UserIntegration.Status.FAILED
            integration.error_message = 'Unknown provider'

        # Update last_validated_at timestamp
        integration.last_validated_at = timezone.now()
        integration.save()

        logger.info(
            f"event=integration_validation_completed integration_id={integration_id} status={integration.status}"
        )
    except Exception as e:
        logger.error(
            f"event=integration_validation_failed integration_id={integration_id} error={e}"
        )
        raise

def validate_github_integration(
    github_token: str, attempts: int = MAX_VALIDATION_ATTEMPTS
) -> tuple[bool, str]:
    """
    Validate GitHub integration token
    Returns: (is_valid, error_message)

    The host's DNS has failed intermittently ("Temporary failure in name resolution"), which
    used to fail a healthy token on the first blip. Network errors are retried with backoff
    and are reported with the TRANSIENT_ERROR_PREFIX so callers can tell them apart from a
    token GitHub actually rejected.
    """
    url = "https://api.github.com/user"
    headers = {
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github.v3+json'
    }

    last_error = f'{TRANSIENT_ERROR_PREFIX}: token validation did not run'

    for attempt in range(1, max(1, attempts) + 1):
        try:
            response = requests.get(url=url, headers=headers, timeout=10)
        except requests.RequestException as e:
            last_error = f'{TRANSIENT_ERROR_PREFIX}: {str(e)}'
            logger.error(
                f"event=validate_github_integration_failed attempt={attempt} error={e}",
                exc_info=True
            )
            if attempt < attempts:
                time.sleep(2 ** (attempt - 1))
            continue

        if response.status_code == 200:
            return (True, '')
        elif response.status_code == 401:
            return (False, 'Token is invalid or expired')
        elif response.status_code == 403:
            return (False, 'Token lacks required permissions')
        elif response.status_code >= 500:
            # GitHub itself is unwell; same treatment as a network error.
            last_error = f'{TRANSIENT_ERROR_PREFIX}: GitHub API answered {response.status_code}'
            if attempt < attempts:
                time.sleep(2 ** (attempt - 1))
            continue
        else:
            return (False, f'GitHub API error: {response.status_code}')

    return (False, last_error)

def validate_slack_integration(slack_token: str) -> bool:
    """Validates Slack token against the auth.test API"""
    try:
        response = requests.post(
            "https://slack.com/api/auth.test",
            headers={"Authorization": f"Bearer {slack_token}"},
            timeout=10,
        )
        return response.json().get("ok", False)
    except Exception:
        return False