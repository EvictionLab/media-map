/**
 * startsWith polyfill
 */
if (!String.prototype.startsWith) {
    Object.defineProperty(String.prototype, 'startsWith', {
        value: function(search, rawPos) {
            var pos = rawPos > 0 ? rawPos|0 : 0;
            return this.substring(pos, pos + search.length) === search;
        }
    });
}

var SHEET_URL = 'https://spreadsheets.google.com/feeds/list/1fIHfkpG134ax5neHQGfipUrWbzPd-EAlVVlYqm4i9iE/1/public/values?alt=json'
var LMS_SHEET_URL = 'https://spreadsheets.google.com/feeds/list/1fIHfkpG134ax5neHQGfipUrWbzPd-EAlVVlYqm4i9iE/3/public/values?alt=json'
mapboxgl.accessToken = 'pk.eyJ1IjoiZXZpY3Rpb24tbGFiIiwiYSI6ImNqY20zamVpcTBwb3gzM28yb292YzM3dXoifQ.uKgAjsMd4qkJNqEtr3XyPQ';
var map = new mapboxgl.Map({
    container: 'map',
    style: './style.json',
    center: [-103.59179687498357, 40.66995747013945],
    zoom: 3
});
var pymChild = new pym.Child();

// Date filter placeholder vars
var filter_start_date = null;
var filter_end_date = null;

// the mediaData variables contain the complete set of data returned from gSheets
var mediaData = { type: 'FeatureCollection', features: [] };
var lmsmediaData = { type: 'FeatureCollection', features: [] };

// the filtered mediaData variables reflect the data corresponding to
// the most recent date filters set by user
var filteredMediaData = { type: 'FeatureCollection', features: [] };
var filteredLmsMediaData = { type: 'FeatureCollection', features: [] };

// variable controlling which data--LMS Data or Media Articles--are displayed
var dataShowing = 'media';

map.on('loaded', function() {
    pymChild.sendHeight();
});

map.on('mouseenter', 'clusters', function() {
    map.getCanvas().style.cursor = 'pointer';
});
map.on('mouseleave', 'clusters', function() {
    map.getCanvas().style.cursor = '';
});
map.on('mouseenter', 'lmsclusters', function() {
    map.getCanvas().style.cursor = 'pointer';
});
map.on('mouseleave', 'lmsclusters', function() {
    map.getCanvas().style.cursor = '';
});

function createTooltip(coords, features) {
    var content = document.createElement('div');
    if (features[0].properties.lmsreferrerlinknotfordisplay) {
        // LMS tool tip
        content.innerHTML = features.map(function (f) {
          return ("<p class='lms-modal'><a target='_blank' href=" + f.properties.institutionwebsite + ">" + f.properties.institution + "</a></p><p class='lms-modal'>" + f.properties.notesdisplayed +"</p>")
        }).join('');
    } else {
        // Media Coverage tool tip
        content.innerHTML = features.map(function (f) {
        return '<p>' + f.properties.outlet + ' <a target="_blank" href="' +
            f.properties.link + '">' + f.properties.title + '</a></p>';
        }).join('');
    }
    new mapboxgl.Popup()
        .setLngLat(coords)
        .setDOMContent(content)
        .addTo(map);
    content.parentNode.className += ' modal-content modal-header';
    document.querySelector('.mapboxgl-popup-close-button').className += ' close';
}

function featuresOnClick(e) {
    if (e.originalEvent.cancelBubble) {
        return;
    } else { // prevent click event from passing along to other nearby clusters
        e.originalEvent.cancelBubble = true;
    }
    if (e.features.length === 0) { return; }
    var coords = e.features[0].geometry.coordinates;
    if (!e.features[0].properties.hasOwnProperty('point_count')) {
        // single item
        createTooltip(coords, e.features);
        return;
    }
    // multiple items aggregated together into a cluster
    var r = 35;

    var bounds = map.getBounds();
    var bb = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    var pt = map.project(coords);
    var sw = map.unproject({ x: pt.x - r, y: pt.y - r });
    var ne = map.unproject({ x: pt.x + r, y: pt.y + r });
    var bbox = [sw.lng, sw.lat, ne.lng, ne.lat];

    var index = supercluster({ radius: r, maxZoom: 14 });
    if (e.features[0].layer.id === 'lmsclusters') {
        index.load(map.getSource('lmsmedia').serialize().data.features);
    } else {
        index.load(map.getSource('media').serialize().data.features);
    }
    var clusterCount = e.features[0].properties.point_count;
    var clusters = index.getClusters(bb, Math.floor(map.getZoom()));
    var matchClusters = clusters.filter(function (c) {
        return (
            c.properties.point_count === clusterCount &&
            turf.booleanContains(turf.bboxPolygon(bbox), c)
        );
    });
    if (matchClusters.length === 1) {
        var clusterId = matchClusters[0].properties.cluster_id;
        var clusterFeatures = index.getLeaves(clusterId, 1000);
        createTooltip(coords, clusterFeatures);
    }
}
map.on('click', 'clusters', featuresOnClick);
map.on('click', 'lmsclusters', featuresOnClick);

var showMediaAndHideLMS = function(data) {
    map.getSource('media').setData(data);
    map.getSource('lmsmedia').setData({ type: 'FeatureCollection', features: [] });
}

var showLMSAndHideMedia = function(data) {
    map.getSource('media').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('lmsmedia').setData(data);
}

let reqHandler = function(source, req) {
    var rows = JSON.parse(req.responseText).feed.entry;
    var properties = Object.keys(rows[0])
        .filter(function (p) { return p.startsWith("gsx$"); })
        .map(function (p) { return p.substr(4); });

    var items = rows.map(function (r) {
        var row = {};
        properties.forEach(function (p) {
            row[p] = r["gsx$" + p].$t === "" ? null : r["gsx$" + p].$t;
            if (['latitude', 'longitude'].indexOf(p) !== -1) {
                row[p] = +row[p];
            }
            if (row[p] === null) {
                row[p] = '';
            }
        });
        return {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [row.longitude, row.latitude]
            },
            properties: row
        };
    });
    // add fetched items into either the media or lmsmedia object
    if (source === 'media') {
        mediaData = { type: 'FeatureCollection', features: items };
        filteredMediaData = { type: 'FeatureCollection', features: items };
    } else {
        lmsmediaData = { type: 'FeatureCollection', features: items };
        filteredLmsMediaData = { type: 'FeatureCollection', features: items };
    }
    // only display one set of data, depending on value of dataShowing variable
    if (dataShowing === 'media') {
        showMediaAndHideLMS(mediaData);
    } else if (dataShowing === 'lmsmedia') {
        showLMSAndHideMedia(lmsmediaData);
    }
}

// Fetch Local Article Data
var req = new XMLHttpRequest();
req.addEventListener("load",  function() { reqHandler('media', req) });
req.open("GET", SHEET_URL);
req.send();

// Fetch LMS Data
var lmsreq = new XMLHttpRequest();
lmsreq.addEventListener("load", function() { reqHandler('lmsmedia', lmsreq) });
lmsreq.open("GET", LMS_SHEET_URL);
lmsreq.send();

jQuery(document).ready(function() {

    // toggle which data -- LMS or media articles -- is showing on map
    $('#toggle-data').click(function(e) {
        dataShowing = (dataShowing === 'media') ? 'lmsmedia' : 'media';
        if (dataShowing === 'media') {
             showMediaAndHideLMS(filteredMediaData);
             $('.switch-toggle').removeClass('on');
        } else if (dataShowing === 'lmsmedia') {
            showLMSAndHideMedia(filteredLmsMediaData);
            $('.switch-toggle').addClass('on');
        }
    })

    // Set date range max
    function setMaxDate() {
        var date = new Date();  //it returns the date
        var month = date.getMonth();
        var year = date.getFullYear();
        $('#end_month_select').val(month).change();
        $('#end_year_select').val(year).change();
    }
    setMaxDate();

    $('#filter_bydate').click(function(e) {
        // Set filter range from form elements.
        var start = new Date(
            $('#start_year_select').val(),
            $('#start_month_select').val()
        );
        filter_start_date = start;
        // End, have to take the last day of the month,
        // which we will get by stepping back from the subsequent month.
        var month = Number($('#end_month_select').val());
        var year = Number($('#end_year_select').val());
        if (month === 11) {
            month = 0;
            year = year + 1;
        } else {
            month = month + 1;
        }
        var end = new Date(year, month, 0);
        filter_end_date = end;
        filteredMediaData = {
            type: 'FeatureCollection',
            features: (mediaData.features).filter(function(obj) {
                var pubDate = new Date(obj.properties.date);
                return (pubDate >=  filter_start_date) && (pubDate <= filter_end_date);
            })
        };
        filteredLmsMediaData = { type: 'FeatureCollection',
            features: (lmsmediaData.features).filter(function(obj) {
                let withinDateBounds = false
                let pubDateList = Object.keys(obj.properties).map(function(p) {
                      if (p.slice(0,4) === 'date' && obj.properties[p]) {
                        // is a "date" property and has a date value input
                        let formattedDate = obj.properties[p].slice(0,3) + "1/" + obj.properties[p].slice(3)
                        // adds a day into the date value so javascript can create a Date object
                        return new Date(formattedDate);
                      }
                    })
                pubDateList.forEach(function(pubDate) {
                    if ((pubDate >=  filter_start_date) && (pubDate <= filter_end_date)) {
                        withinDateBounds = true
                    }
                })
                return withinDateBounds;
            })
        };
        // Reload the map.
        if (dataShowing === 'media') {
            showMediaAndHideLMS(filteredMediaData);
        } else if (dataShowing === 'lmsmedia') {
            showLMSAndHideMedia(filteredLmsMediaData);
        }
    });

    /**
     * Validate the end range, removing months beyond the current
     * month if the selected year is the current year.
     * @return null
     */
    function validateEndRange(el) {
        // Get element and sibling
        var $el = $(el);
        var $month = $el.prev('.month');
        // Get current datetime
        var now = new Date();
        var thisMonth = now.getMonth();
        var thisYear = now.getFullYear();
        // Minimal max month validation against current year
        if ($el.val() == thisYear) {
            $month.find('option').each(function() {
                if (Number(this.value) > thisMonth) {
                    $(this).attr('disabled', 'disabled');
                } else {
                    $(this).removeAttr('disabled');
                    $month.val(thisMonth);
                }
            });
        } else {
            $month.find('option').each(function() {
                $(this).removeAttr('disabled');
            });
        }
    }
    $('#end_year_select, #start_year_select').on('change', function(e) {
        validateEndRange(e.target);
    });
    validateEndRange('#end_year_select');
    /**
     * Validate full date range, ensuring that end date selections
     * are after selected start date.
     * @return null
     */
    function validateFullDateRange() {
        var start_month = Number($('#start_month_select').val());
        var start_year = Number($('#start_year_select').val());
        var end_month = Number($('#end_month_select').val());
        var end_year = Number($('#end_year_select').val());

        if (end_year === start_year) {
            // When end year same as start year,
            // if end month less than start month,
            // validation error. Else proceed.
            if (end_month < start_month) {
                // Disable filter button
                $('#filter_bydate').prop('disabled', 'disabled').text('Invalid date selection');
                // Add invalid classes
                $('#end_year_select, #end_month_select').addClass('select-invalid');
            } else {
                // Enable filter button
                $('#filter_bydate').prop('disabled', false).text('Go');
                // Add invalid classes
                $('#end_year_select, #end_month_select').removeClass('select-invalid');
            }
        } else if (end_year < start_year) {
            // When end year less than start year,
            // validation error.
            // Disable filter button
            $('#filter_bydate').prop('disabled', 'disabled').text('Invalid date selection');
            // Add invalid classes
            $('#end_year_select, #end_month_select').addClass('select-invalid');
        } else {
            // Else remove any preceding validation
            // error warnings.
            // Enable filter button
            $('#filter_bydate').prop('disabled', false).text('Go');
            // Add invalid classes
            $('#end_year_select, #end_month_select').removeClass('select-invalid');
        }
    }
    $('#start_month_select, #start_year_select, #end_month_select, #end_year_select').on('change', function() {
        validateFullDateRange();
    });
    validateEndRange();
});
