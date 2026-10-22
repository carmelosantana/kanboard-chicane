<?php
namespace Kanboard\Plugin\Chicane\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\Chicane\Model\RaceSettings;

// Public share-token routes (APP_PUBLIC in Plugin.php). Unknown token and non-shared visibility both 404.
class RaceShareController extends BaseController
{
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

    // Stub until Task 4.
    public function state(): void
    {
        $this->emptyJson();
    }

    // Stub until Task 5.
    public function summary(): void
    {
        $this->emptyJson();
    }

    private function emptyJson(): void
    {
        if ($this->allowedMode($this->token()) === null) {
            return;
        }
        $this->response->withContentType('application/json');
        $this->response->withoutCache();
        $this->response->withBody('{}');
        $this->response->send();
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
