<?php
namespace Kanboard\Plugin\Chicane\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\Chicane\Model\RaceRedactor;
use Kanboard\Plugin\Chicane\Model\RaceSettings;
use Kanboard\Plugin\Chicane\Model\RaceStateModel;
use Kanboard\Plugin\Chicane\Model\RaceSummary;

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
        $settings = new RaceSettings($this->container);
        $this->response->html($this->template->render('Chicane:race/page', [
            'title' => t('Race track'),
            'config' => $settings->pageConfig(
                (int) $settings->projectIdForToken($token),
                $this->helper->url->to('RaceShareController', 'state', ['plugin' => 'Chicane', 'token' => $token]),
                $mode === 'map_only'
            ),
        ]));
    }

    // map_only is redacted here, on the server; the ETag is taken from what is actually sent.
    public function state(): void
    {
        $token = $this->token();
        $mode = $this->allowedMode($token);
        if ($mode === null) {
            return;
        }
        $model = new RaceStateModel($this->container);
        $state = $this->buildState($model, $token);
        if ($mode === 'map_only') {
            $state = RaceRedactor::mapOnly($state);
        }
        $this->sendJson($state, $model->etag($state));
    }

    public function summary(): void
    {
        $token = $this->token();
        $mode = $this->allowedMode($token);
        if ($mode === null) {
            return;
        }
        $units = (new RaceSettings($this->container))->get($this->projectId($token))['units'];
        $this->sendJson(RaceSummary::build($this->buildState(new RaceStateModel($this->container), $token), $mode, $units));
    }

    private function buildState(RaceStateModel $model, string $token): array
    {
        $projectId = $this->projectId($token);
        return $model->build($projectId, (new RaceSettings($this->container))->get($projectId)['window_days']);
    }

    private function projectId(string $token): int
    {
        return (int) (new RaceSettings($this->container))->projectIdForToken($token);
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
