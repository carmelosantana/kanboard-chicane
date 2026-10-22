<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Core\Http\Request;
use Kanboard\Core\Http\Response;
use Kanboard\Model\ProjectModel;
use Kanboard\Plugin\Chicane\Controller\RaceSettingsController;
use Kanboard\Plugin\Chicane\Controller\RaceShareController;
use Kanboard\Plugin\Chicane\Model\RaceSettings;
use Kanboard\Plugin\Chicane\Plugin;

// The settings form and share routes driven through their controllers, the way a browser posts and reads them.
class RaceSettingsControllerTest extends Base
{
    private int $pid;
    private RaceSettings $settings;

    protected function setUp(): void
    {
        parent::setUp();
        $this->container['route']->enable();
        (new Plugin($this->container))->initialize();
        $this->pid = (new ProjectModel($this->container))->create(['name' => 'Track']);
        $this->settings = new RaceSettings($this->container);
    }

    public function testSavePersistsComplexityUnits(): void
    {
        $this->post(['visibility' => 'members', 'window_days' => '14', 'units' => 'complexity']);
        $this->assertSame(['members', 14, 'complexity'], $this->saved());
    }

    // Same as visibility and window: an invalid value rejects the whole save and nothing changes.
    public function testSaveRejectsUnknownUnits(): void
    {
        $this->post(['visibility' => 'public', 'window_days' => '14', 'units' => 'story_points']);
        $this->assertSame(['off', 30, 'subtask'], $this->saved());
    }

    public function testSettingsPageOffersBothUnits(): void
    {
        $this->settings->save($this->pid, ['units' => 'complexity']);
        $html = $this->page();
        $this->assertMatchesRegularExpression('/<select[^>]+name="units"/', $html);
        $this->assertStringContainsString('<option value="subtask"', $html);
        $this->assertMatchesRegularExpression('/<option value="complexity"[^>]*selected/', $html);
    }

    public function testSharedPageShowsCopyableShareAndSummaryUrls(): void
    {
        $token = $this->settings->get($this->pid)['token'];
        foreach (['public', 'map_only'] as $visibility) {
            $this->settings->save($this->pid, ['visibility' => $visibility]);
            $html = $this->page();
            foreach (['/race/'.$token, '/race/'.$token.'/summary.json'] as $path) {
                $this->assertMatchesRegularExpression('#<input[^>]+readonly[^>]+value="http://localhost'.preg_quote($path, '#').'"#', $html, $visibility.' '.$path);
            }
        }
    }

    public function testUnsharedPageShowsNoUrls(): void
    {
        $token = $this->settings->get($this->pid)['token'];
        foreach (['off', 'members'] as $visibility) {
            $this->settings->save($this->pid, ['visibility' => $visibility]);
            $this->assertStringNotContainsString($token, $this->page(), $visibility);
        }
    }

    public function testSummaryEndpointFollowsUnits(): void
    {
        $token = $this->settings->get($this->pid)['token'];
        $this->settings->save($this->pid, ['visibility' => 'public', 'units' => 'complexity']);
        $this->container['taskCreationModel']->create(['project_id' => $this->pid, 'title' => 'Hairpin', 'score' => 5]);

        $this->useRequest(['REQUEST_METHOD' => 'GET'], ['token' => $token], []);
        (new RaceShareController($this->container))->summary();
        $summary = json_decode($this->container['response']->body, true);

        // One open task, score 5, no subtasks: 5 units, 1 still open (track.js complexity rule).
        $this->assertSame(1, $summary['distance_to_finish']);
        $this->assertEquals(80.0, $summary['progress_pct']); // JSON drops the .0
    }

    private function post(array $values): void
    {
        $csrf = $this->container['token']->getCSRFToken();
        $this->useRequest(['REQUEST_METHOD' => 'POST'], ['project_id' => $this->pid], $values + ['csrf_token' => $csrf]);
        (new RaceSettingsController($this->container))->save();
    }

    private function page(): string
    {
        return $this->container['template']->render('Chicane:project/settings', [
            'project' => $this->container['projectModel']->getById($this->pid),
            'settings' => $this->settings->get($this->pid),
            'visibilities' => RaceSettings::VISIBILITY,
            'units' => RaceSettings::UNITS,
        ]);
    }

    private function saved(): array
    {
        $s = $this->settings->get($this->pid);
        return [$s['visibility'], $s['window_days'], $s['units']];
    }

    private function useRequest(array $server, array $get, array $post): void
    {
        $server += ['SERVER_PROTOCOL' => 'HTTP/1.1'];
        $request = new Request($this->container, $server, $get, $post, ['none' => true], ['none' => true]);
        $this->container['request'] = $request;
        // Records the body instead of calling header(), which PHPUnit's CLI output turns into an error.
        $this->container['response'] = new class($this->container) extends Response {
            public string $body = '';
            public function withBody($body) { $this->body = $body; return parent::withBody($body); }
            public function send() {}
        };
    }
}
