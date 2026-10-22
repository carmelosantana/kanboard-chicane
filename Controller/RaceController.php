<?php
namespace Kanboard\Plugin\Chicane\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\Chicane\Model\RaceGate;
use Kanboard\Plugin\Chicane\Model\RaceSettings;
use Kanboard\Plugin\Chicane\Model\RaceStateModel;

// Members' race view. Not in any access map, so Kanboard's project default role (viewer) gates it:
// reaching an action means the user is a member of project_id.
class RaceController extends BaseController
{
    use JsonResponder;

    public function show(): void
    {
        $project = $this->allowedProject();
        if ($project === null) {
            return;
        }
        $this->response->html($this->template->render('Chicane:race/page', [
            'title' => $project['name'],
            'config' => [
                'stateUrl' => $this->helper->url->to('RaceController', 'state', ['plugin' => 'Chicane', 'project_id' => $project['id']]),
                'mapOnly' => false,
                'pollMs' => 20000,
            ],
        ]));
    }

    public function state(): void
    {
        $project = $this->allowedProject();
        if ($project === null) {
            return;
        }
        $projectId = (int) $project['id'];
        $windowDays = (new RaceSettings($this->container))->get($projectId)['window_days'];
        $model = new RaceStateModel($this->container);
        $state = $model->build($projectId, $windowDays);
        $this->sendJson($state, $model->etag($state));
    }

    private function allowedProject(): ?array
    {
        $project = $this->getProject();
        $visibility = (new RaceSettings($this->container))->visibilityOf((int) $project['id']);
        if (RaceGate::decide($visibility, true, false) === null) {
            $this->response->status(404);
            return null;
        }
        return $project;
    }
}
