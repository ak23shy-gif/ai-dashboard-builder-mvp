import asyncio
from types import SimpleNamespace

import pytest

from backend.connectors import Ads


def schema():
    fields = []
    for report in ("campaign", "ad_group", "keyword_view"):
        fields.append({"name": report, "category": "RESOURCE", "attributeResources": ["customer", "campaign"] + (["ad_group_criterion"] if report == "keyword_view" else []), "segments": ["segments.date", "segments.device"], "metrics": ["metrics.clicks", "metrics.average_cpc", "metrics.conversions_value"]})
    for name in ("customer.descriptive_name", "campaign.name", "ad_group.name", "ad_group_criterion.keyword.text"):
        fields.append({"name": name, "category": "ATTRIBUTE", "selectable": True, "dataType": "STRING"})
    for name in ("segments.date", "segments.device"):
        fields.append({"name": name, "category": "SEGMENT", "selectable": True, "dataType": "STRING", "selectableWith": ["metrics.clicks", "metrics.average_cpc", "metrics.conversions_value"]})
    for name, dtype in (("metrics.clicks", "INT64"), ("metrics.average_cpc", "DOUBLE"), ("metrics.conversions_value", "DOUBLE")):
        fields.append({"name": name, "category": "METRIC", "selectable": True, "dataType": dtype})
    fields += [{"name": "campaign.labels", "category": "ATTRIBUTE", "selectable": True, "dataType": "STRING", "isRepeated": True}, {"name": "campaign.message", "category": "ATTRIBUTE", "selectable": True, "dataType": "MESSAGE"}]
    return fields


@pytest.fixture(autouse=True)
def fresh_metadata():
    Ads._metadata_cache.clear()
    yield
    Ads._metadata_cache.clear()


def test_metadata_pagination_cache_and_report_fields():
    calls = []
    async def api(method, url, **kw):
        calls.append(dict(kw["json"]))
        assert url.endswith("/googleAdsFields:search")
        assert " FROM " not in kw["json"]["query"]
        assert kw["headers"] == {}
        if not kw["json"].get("pageToken"):
            return {"results": schema()[:3], "nextPageToken": "next"}
        return {"results": schema()[3:]}
    async def run():
        a, b = await asyncio.gather(Ads(api).fields("1:9"), Ads(api).fields("2:9"))
        assert a == b
        assert "ad_group.name" in a["reports"]["ad_group"]["dimensions"]
        assert "ad_group.name" not in a["reports"]["campaign"]["dimensions"]
        assert "ad_group_criterion.keyword.text" in a["reports"]["keyword_view"]["dimensions"]
        assert "campaign.labels" not in a["dimensions"]
        assert "campaign.message" not in a["dimensions"]
        assert "metrics.average_cpc" in a["metrics"]
    asyncio.run(run())
    assert len(calls) == 2
    assert calls[1]["pageToken"] == "next"


def query(**changes):
    return SimpleNamespace(**({"resource": "123:999", "start": "2026-01-01", "end": "2026-01-31", "dimensions": ["ad_group.name"], "metrics": ["metrics.clicks", "metrics.average_cpc", "metrics.conversions_value"], "options": {"ads_report": "ad_group"}} | changes))


def test_selected_report_decimal_metrics_and_result_pagination():
    searches = []
    async def api(method, url, **kw):
        if url.endswith("googleAdsFields:search"):
            return {"results": schema()}
        searches.append(dict(kw["json"]))
        assert kw["headers"] == {"login-customer-id": "999"}
        assert " FROM ad_group WHERE segments.date BETWEEN '2026-01-01' AND '2026-01-31'" in kw["json"]["query"]
        return {"results": [{"adGroup": {"name": "Group"}, "metrics": {"clicks": "12", "averageCpc": 1200.25, "conversionsValue": 4.75}}], **({"nextPageToken": "more"} if len(searches) == 1 else {})}
    async def run():
        batches = [b async for b in Ads(api).extract(query())]
        assert len(batches) == 2
        assert batches[0][0] == {"ad_group.name": "Group", "metrics.clicks": 12, "metrics.average_cpc": 1200.25, "metrics.conversions_value": 4.75}
    asyncio.run(run())
    assert searches[1]["pageToken"] == "more"


@pytest.mark.parametrize("changes", [{"options": {"ads_report": "campaign"}}, {"options": {"ads_report": "campaign; DROP TABLE"}}, {"dimensions": ["campaign.name, metrics.clicks"]}])
def test_rejects_wrong_report_or_unknown_fields(changes):
    async def api(method, url, **kw):
        assert url.endswith("googleAdsFields:search")
        return {"results": schema()}
    async def run():
        with pytest.raises(ValueError, match="selected report"):
            _ = [b async for b in Ads(api).extract(query(**changes))]
    asyncio.run(run())


def test_rejects_incompatible_segment_metric_before_search():
    async def api(method, url, **kw):
        assert url.endswith("googleAdsFields:search")
        data = schema()
        next(f for f in data if f["name"] == "segments.device")["selectableWith"] = ["metrics.clicks"]
        return {"results": data}
    async def run():
        with pytest.raises(ValueError, match="cannot combine segments.device"):
            _ = [b async for b in Ads(api).extract(query(dimensions=["segments.device"]))]
    asyncio.run(run())
