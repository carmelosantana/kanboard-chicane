<?php
namespace Kanboard\Plugin\Chicane\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\Chicane\Model\RaceGate;
use Kanboard\Plugin\Chicane\Model\RaceSettings;

// Members' race view. Not in any access map, so Kanboard's project default role (viewer) gates it:
// reaching an action means the user is a member of project_id.
class RaceController extends BaseController
{
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

    // Stub until Task 4.
    public function state(): void
    {
        if ($this->allowedProject() === null) {
            return;
        }
        $this->response->withContentType('application/json');
        $this->response->withoutCache();
        $this->response->withBody('{}');
        $this->response->send();
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
