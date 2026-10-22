<?php
namespace Kanboard\Plugin\Chicane\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Core\Controller\AccessForbiddenException;
use Kanboard\Plugin\Chicane\Model\RaceSettings;

// Project-manager only (projectAccessMap in Plugin.php). Writes are POST + CSRF; project_id rides in the URL for the ACL middleware.
class RaceSettingsController extends BaseController
{
    public function show(): void
    {
        $project = $this->getProject();
        $this->response->html($this->helper->layout->project('Chicane:project/settings', [
            'project' => $project,
            'settings' => (new RaceSettings($this->container))->get((int) $project['id']),
            'visibilities' => RaceSettings::VISIBILITY,
            'title' => t('Race track'),
        ]));
    }

    public function save(): void
    {
        $project = $this->postedProject();
        $values = $this->request->getValues();
        $ok = (new RaceSettings($this->container))->save((int) $project['id'], [
            'visibility' => $values['visibility'] ?? '',
            'window_days' => $values['window_days'] ?? '',
        ]);
        $ok ? $this->flash->success(t('Race track settings saved.')) : $this->flash->failure(t('Unable to save the race track settings.'));
        $this->redirectToShow($project);
    }

    public function rotate(): void
    {
        $project = $this->postedProject();
        try {
            (new RaceSettings($this->container))->rotateToken((int) $project['id']);
            $this->flash->success(t('Share link replaced. The old link no longer works.'));
        } catch (\RuntimeException $e) {
            $this->logger->error($e->getMessage());
            $this->flash->failure(t('Unable to replace the share link. The current link still works.'));
        }
        $this->redirectToShow($project);
    }

    private function postedProject(): array
    {
        if (! $this->request->isPost()) {
            throw new AccessForbiddenException();
        }
        $this->checkCSRFForm();
        return $this->getProject();
    }

    private function redirectToShow(array $project): void
    {
        $this->response->redirect($this->helper->url->to('RaceSettingsController', 'show', ['plugin' => 'Chicane', 'project_id' => $project['id']]));
    }
}
