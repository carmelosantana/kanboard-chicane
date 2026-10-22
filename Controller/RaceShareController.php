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
        [$projectId, $mode] = $this->share() ?? [null, null];
        if ($mode === null) {
            return;
        }
        $this->response->html($this->template->render('Chicane:race/page', [
            'title' => t('Race track'),
            'config' => (new RaceSettings($this->container))->pageConfig(
                $projectId,
                $this->helper->url->to('RaceShareController', 'state', ['plugin' => 'Chicane', 'token' => $this->token()]),
                $mode === 'map_only'
            ),
        ]));
    }

    // map_only is redacted here, on the server; the ETag is taken from what is actually sent.
    public function state(): void
    {
        [$projectId, $mode] = $this->share() ?? [null, null];
        if ($mode === null) {
            return;
        }
        $model = new RaceStateModel($this->container);
        $state = $model->build($projectId, (new RaceSettings($this->container))->get($projectId)['window_days']);
        if ($mode === 'map_only') {
            $state = RaceRedactor::mapOnly($state);
        }
        $this->sendJson($state, $model->etag($state));
    }

    public function summary(): void
    {
        [$projectId, $mode] = $this->share() ?? [null, null];
        if ($mode === null) {
            return;
        }
        $settings = (new RaceSettings($this->container))->get($projectId);
        $state = (new RaceStateModel($this->container))->build($projectId, $settings['window_days']);
        $summary = RaceSummary::build($state, $mode, $settings['units']);
        $this->sendJson($summary, RaceSummary::etag($summary));
    }

    private function token(): string
    {
        return $this->request->getStringParam('token');
    }

    // Resolves the token once: [project id, share mode], or null after sending 404.
    /** @return array{int, string}|null */
    private function share(): ?array
    {
        $settings = new RaceSettings($this->container);
        $projectId = $settings->projectIdForToken($this->token());
        $mode = $projectId === null ? null : $settings->shareModeOf($projectId);
        if ($mode === null) {
            $this->response->status(404);
            return null;
        }
        return [$projectId, $mode];
    }
}
