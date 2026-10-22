<?php
namespace Kanboard\Plugin\Chicane\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\Chicane\Model\RaceSettings;
use Kanboard\Plugin\Chicane\Model\RaceStateModel;

// Public share-token routes (APP_PUBLIC in Plugin.php). Unknown token and non-shared visibility both 404.
class RaceShareController extends BaseController
{
    use JsonResponder;

    public function show(): void
    {
        $token = $this->token();
        $mode = $this->allowedMode($token);
        if ($mode === null) {
            return;
        }
        $this->response->html($this->template->render('Chicane:race/page', [
            'title' => t('Race track'),
            'config' => [
                'stateUrl' => $this->helper->url->to('RaceShareController', 'state', ['plugin' => 'Chicane', 'token' => $token]),
                'mapOnly' => $mode === 'map_only',
                'pollMs' => 20000,
            ],
        ]));
    }

    // Map-only redaction lands in Task 5; until then map_only gets an empty object, never the full state.
    public function state(): void
    {
        $token = $this->token();
        $mode = $this->allowedMode($token);
        if ($mode === null) {
            return;
        }
        if ($mode !== 'full') {
            $this->sendJson([]);
            return;
        }
        $settings = new RaceSettings($this->container);
        $projectId = (int) $settings->projectIdForToken($token);
        $model = new RaceStateModel($this->container);
        $state = $model->build($projectId, $settings->get($projectId)['window_days']);
        $this->sendJson($state, $model->etag($state));
    }

    // Stub until Task 5.
    public function summary(): void
    {
        if ($this->allowedMode($this->token()) !== null) {
            $this->sendJson([]);
        }
    }

    private function token(): string
    {
        return $this->request->getStringParam('token');
    }

    private function allowedMode(string $token): ?string
    {
        $mode = (new RaceSettings($this->container))->shareMode($token);
        if ($mode === null) {
            $this->response->status(404);
        }
        return $mode;
    }
}
